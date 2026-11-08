import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '../../core/concurrency/keyed-mutex';
import { LockManager } from '../../core/concurrency/lock-manager';
import { FakeClock } from '../../testing/fake-clock';
import { NoOpLockManager } from '../../testing/no-op-lock-manager';
import { InsufficientStockError } from '../../products/domain/product.errors';
import {
  IdempotencyKeyMismatchError,
  InvalidReservationStateError,
} from '../domain/reservation.errors';
import { Product } from '../../products/domain/product';
import { Reservation, ReservationStatus } from '../domain/reservation';
import { InMemoryProductRepository } from '../../products/repositories/in-memory-product.repository';
import { InMemoryReservationRepository } from '../repositories/in-memory-reservation.repository';
import { ReservationService, type ReserveCommand } from './reservation.service';

const HOLD_MS = 120_000;

const fireConcurrently = <T>(count: number, task: (i: number) => Promise<T>) =>
  Promise.allSettled(Array.from({ length: count }, (_, i) => task(i)));

const fulfilled = <T>(results: PromiseSettledResult<T>[]): T[] =>
  results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
    .map((r) => r.value);

const rejectionReasons = (results: PromiseSettledResult<unknown>[]) =>
  results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason as Error);

describe('ReservationService under concurrency (Level 3)', () => {
  let products: InMemoryProductRepository;
  let reservations: InMemoryReservationRepository;
  let clock: FakeClock;
  let service: ReservationService;

  const build = (lock: LockManager = new KeyedMutex()) => {
    products = new InMemoryProductRepository();
    reservations = new InMemoryReservationRepository();
    clock = new FakeClock();
    service = new ReservationService(products, reservations, lock, clock, {
      holdDurationMs: HOLD_MS,
      expirySweepIntervalMs: 1000,
    });
  };

  /** Each call is a distinct purchase attempt, so it gets its own key. */
  const reserve = (
    command: Omit<ReserveCommand, 'idempotencyKey'> & {
      idempotencyKey?: string;
    },
  ) => service.reserve({ idempotencyKey: randomUUID(), ...command });

  const seed = (totalStock: number, id = 'p-1') =>
    products.save(Product.create({ id, name: 'Flash Deal', totalStock }));

  /** product.reserved/sold must equal the sum of ACTIVE/CONFIRMED holds. */
  const expectCountersToMatch = async (
    ids: string[],
    productId = 'p-1',
  ): Promise<void> => {
    const all = await Promise.all(ids.map((id) => service.getById(id)));
    const sum = (status: ReservationStatus) =>
      all
        .filter((r) => r.status === status)
        .reduce((total, r) => total + r.quantity, 0);
    const product = (await products.findById(productId))!;

    expect(product.reserved).toBe(sum(ReservationStatus.Active));
    expect(product.sold).toBe(sum(ReservationStatus.Confirmed));
    expect(product.available).toBeGreaterThanOrEqual(0);
  };

  beforeEach(() => build());

  it('stock = 1, 500 simultaneous requests: 1 success, 499 failures', async () => {
    await seed(1);

    const results = await fireConcurrently(500, (i) =>
      reserve({ productId: 'p-1', userId: `user-${i}` }),
    );

    expect(fulfilled(results)).toHaveLength(1);
    const failures = rejectionReasons(results);
    expect(failures).toHaveLength(499);
    expect(
      failures.every((error) => error instanceof InsufficientStockError),
    ).toBe(true);
    expect((await products.findById('p-1'))!.available).toBe(0);
  });

  it('stock = 10, 500 simultaneous requests: exactly 10 succeed', async () => {
    await seed(10);

    const results = await fireConcurrently(500, (i) =>
      reserve({ productId: 'p-1', userId: `user-${i}` }),
    );

    const winners = fulfilled(results);
    expect(winners).toHaveLength(10);
    await expectCountersToMatch(winners.map((r) => r.id));
  });

  it('mixed quantities never oversell', async () => {
    await seed(25);

    const results = await fireConcurrently(300, (i) =>
      reserve({
        productId: 'p-1',
        userId: `user-${i}`,
        quantity: (i % 4) + 1,
      }),
    );

    const winners = fulfilled(results);
    const reservedUnits = winners.reduce((sum, r) => sum + r.quantity, 0);
    expect(reservedUnits).toBeLessThanOrEqual(25);
    await expectCountersToMatch(winners.map((r) => r.id));
  });

  it('contention on one product does not affect another', async () => {
    await seed(1, 'p-1');
    await seed(1, 'p-2');

    const results = await fireConcurrently(500, (i) =>
      reserve({ productId: i % 2 ? 'p-1' : 'p-2', userId: `u-${i}` }),
    );

    const winners = fulfilled(results);
    expect(winners.map((r) => r.productId).sort()).toEqual(['p-1', 'p-2']);
  });

  it('500 simultaneous confirms (retry storm / duplicate webhooks): all succeed, sold once', async () => {
    await seed(1);
    const { id } = await reserve({ productId: 'p-1', userId: 'alice' });

    const results = await fireConcurrently(500, () => service.confirm(id));

    const confirmations = fulfilled(results);
    expect(confirmations).toHaveLength(500);
    expect(
      confirmations.every((r) => r.status === ReservationStatus.Confirmed),
    ).toBe(true);
    expect((await products.findById('p-1'))!.sold).toBe(1);
    await expectCountersToMatch([id]);
  });

  it('double-click: 100 simultaneous reserves with one Idempotency-Key hold stock once', async () => {
    await seed(10);

    const results = await fireConcurrently(100, () =>
      reserve({
        productId: 'p-1',
        userId: 'alice',
        idempotencyKey: 'click-1',
      }),
    );

    const ids = new Set(fulfilled(results).map((r) => r.id));
    expect(fulfilled(results)).toHaveLength(100);
    expect(ids.size).toBe(1);
    await expectCountersToMatch([...ids]);
  });

  it('one key raced across two products creates exactly one reservation', async () => {
    await seed(10, 'p-1');
    await seed(10, 'p-2');

    const results = await fireConcurrently(100, (i) =>
      reserve({
        productId: i % 2 ? 'p-1' : 'p-2',
        userId: 'alice',
        idempotencyKey: 'click-1',
      }),
    );

    const ids = new Set(fulfilled(results).map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(
      rejectionReasons(results).every(
        (error) => error instanceof IdempotencyKeyMismatchError,
      ),
    ).toBe(true);
    const held =
      (await products.findById('p-1'))!.reserved +
      (await products.findById('p-2'))!.reserved;
    expect(held).toBe(1);
  });

  it('confirm racing cancel on the same reservation: exactly one wins', async () => {
    await seed(2);
    const target = await reserve({ productId: 'p-1', userId: 'a' });
    const other = await reserve({ productId: 'p-1', userId: 'b' });

    const results = await Promise.allSettled([
      service.confirm(target.id),
      service.cancel(target.id),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejectionReasons(results)[0]).toBeInstanceOf(
      InvalidReservationStateError,
    );
    await expectCountersToMatch([target.id, other.id]);
  });

  it('confirm racing the expiry sweeper: stock is settled exactly once', async () => {
    await seed(1);
    const { id } = await reserve({ productId: 'p-1', userId: 'alice' });
    clock.advanceBy(HOLD_MS);

    await Promise.allSettled([
      service.confirm(id),
      service.expireDueReservations(),
      service.expireDueReservations(),
    ]);

    expect((await service.getById(id)).status).toBe(ReservationStatus.Expired);
    await expectCountersToMatch([id]);
    expect((await products.findById('p-1'))!.available).toBe(1);
  });

  it('after expiry, 500 users race for the released unit: 1 wins', async () => {
    await seed(1);
    const stale = await reserve({ productId: 'p-1', userId: 'early' });
    clock.advanceBy(HOLD_MS);

    const results = await fireConcurrently(500, (i) =>
      reserve({ productId: 'p-1', userId: `user-${i}` }),
    );

    const winners: Reservation[] = fulfilled(results);
    expect(winners).toHaveLength(1);
    await expectCountersToMatch([stale.id, winners[0].id]);
  });

  describe('why the per-product lock exists (same scenario, lock disabled)', () => {
    beforeEach(() => build(new NoOpLockManager()));

    it('confirm and cancel can BOTH succeed, corrupting the stock counters', async () => {
      await seed(2);
      const target = await reserve({ productId: 'p-1', userId: 'a' });
      await reserve({ productId: 'p-1', userId: 'b' });

      const results = await Promise.allSettled([
        service.confirm(target.id),
        service.cancel(target.id),
      ]);

      // Each request read the reservation as ACTIVE before the other wrote.
      // The atomic stock updates alone cannot see that conflict: both the
      // commit and the release are individually valid against the counters.
      expect(fulfilled(results)).toHaveLength(2);
      const product = (await products.findById('p-1'))!;
      expect(product.reserved + product.sold).toBe(1); // but 2 units are held
    });
  });
});
