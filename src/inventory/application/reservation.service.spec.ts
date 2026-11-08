import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '../../common/concurrency/keyed-mutex';
import { FakeClock } from '../../testing/fake-clock';
import {
  InsufficientStockError,
  ProductNotFoundError,
  InvalidQuantityError,
  IdempotencyKeyMismatchError,
  InvalidReservationStateError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '../domain/errors';
import { Product } from '../domain/product';
import { ReservationStatus } from '../domain/reservation';
import { InMemoryProductRepository } from '../repositories/in-memory-product.repository';
import { InMemoryReservationRepository } from '../repositories/in-memory-reservation.repository';
import { ReservationService, type ReserveCommand } from './reservation.service';

const HOLD_MS = 2 * 60 * 1000;
const CONFIG = { holdDurationMs: HOLD_MS, expirySweepIntervalMs: 1000 };

describe('ReservationService', () => {
  let products: InMemoryProductRepository;
  let reservations: InMemoryReservationRepository;
  let clock: FakeClock;
  let service: ReservationService;

  const seedProduct = async (totalStock: number, id = 'p-1') => {
    await products.save(Product.create({ id, name: 'Sneaker', totalStock }));
  };

  /** Each call is a distinct purchase attempt, so it gets its own key. */
  const reserve = (
    command: Omit<ReserveCommand, 'idempotencyKey'> & {
      idempotencyKey?: string;
    },
  ) => service.reserve({ idempotencyKey: randomUUID(), ...command });

  const stockOf = async (id = 'p-1') => (await products.findById(id))!;

  beforeEach(() => {
    products = new InMemoryProductRepository();
    reservations = new InMemoryReservationRepository();
    clock = new FakeClock();
    service = new ReservationService(
      products,
      reservations,
      new KeyedMutex(),
      clock,
      CONFIG,
    );
  });

  describe('Level 1: reserve', () => {
    it('creates an active reservation that holds stock for 2 minutes', async () => {
      await seedProduct(5);

      const reservation = await reserve({
        productId: 'p-1',
        userId: 'alice',
        quantity: 2,
      });

      expect(reservation.status).toBe(ReservationStatus.Active);
      expect(reservation.expiresAt.getTime() - clock.now().getTime()).toBe(
        HOLD_MS,
      );
      expect((await stockOf()).available).toBe(3);
      await expect(
        reservations.findById(reservation.id),
      ).resolves.not.toBeNull();
    });

    it('defaults to a quantity of one', async () => {
      await seedProduct(5);

      const reservation = await reserve({
        productId: 'p-1',
        userId: 'alice',
      });

      expect(reservation.quantity).toBe(1);
    });

    it('stock = 1: user A succeeds, user B fails', async () => {
      await seedProduct(1);

      await expect(
        reserve({ productId: 'p-1', userId: 'A' }),
      ).resolves.toBeDefined();
      await expect(reserve({ productId: 'p-1', userId: 'B' })).rejects.toThrow(
        InsufficientStockError,
      );
    });

    it('rejects a reservation exceeding available stock', async () => {
      await seedProduct(3);

      await expect(
        reserve({ productId: 'p-1', userId: 'alice', quantity: 4 }),
      ).rejects.toThrow(InsufficientStockError);
      expect((await stockOf()).available).toBe(3);
    });

    it('rejects an unknown product', async () => {
      await expect(
        reserve({ productId: 'missing', userId: 'alice' }),
      ).rejects.toThrow(ProductNotFoundError);
    });

    it('rejects an invalid quantity without touching stock', async () => {
      await seedProduct(3);

      await expect(
        reserve({ productId: 'p-1', userId: 'alice', quantity: 0 }),
      ).rejects.toThrow(InvalidQuantityError);
      expect((await stockOf()).available).toBe(3);
    });
  });
  describe('Level 2: lifecycle', () => {
    const reserveOne = (quantity = 1) =>
      reserve({ productId: 'p-1', userId: 'alice', quantity });

    describe('confirm', () => {
      it('completes the purchase: reserved stock becomes sold', async () => {
        await seedProduct(5);
        const { id } = await reserveOne(2);

        const confirmed = await service.confirm(id);

        expect(confirmed.status).toBe(ReservationStatus.Confirmed);
        const product = await stockOf();
        expect(product.sold).toBe(2);
        expect(product.reserved).toBe(0);
        expect(product.available).toBe(3);
      });

      it('is idempotent: a repeated confirm succeeds and sells only once', async () => {
        await seedProduct(5);
        const { id } = await reserveOne();
        const first = await service.confirm(id);

        const second = await service.confirm(id);

        expect(second.status).toBe(ReservationStatus.Confirmed);
        expect(second.updatedAt).toEqual(first.updatedAt);
        expect((await stockOf()).sold).toBe(1);
      });

      it('cannot confirm a cancelled reservation', async () => {
        await seedProduct(1);
        const { id } = await reserveOne();
        await service.cancel(id);

        await expect(service.confirm(id)).rejects.toThrow(
          InvalidReservationStateError,
        );
        expect((await stockOf()).sold).toBe(0);
      });

      it('fails for an unknown reservation', async () => {
        await expect(service.confirm('missing')).rejects.toThrow(
          ReservationNotFoundError,
        );
      });

      it('fails after 2 minutes and releases the stock immediately', async () => {
        await seedProduct(1);
        const { id } = await reserveOne();
        clock.advanceBy(HOLD_MS);

        await expect(service.confirm(id)).rejects.toThrow(
          ReservationExpiredError,
        );
        expect((await stockOf()).available).toBe(1);
        expect((await service.getById(id)).status).toBe(
          ReservationStatus.Expired,
        );
      });

      it('succeeds one millisecond before the deadline', async () => {
        await seedProduct(1);
        const { id } = await reserveOne();
        clock.advanceBy(HOLD_MS - 1);

        await expect(service.confirm(id)).resolves.toMatchObject({
          status: ReservationStatus.Confirmed,
        });
      });
    });

    describe('cancel', () => {
      it('releases the stock back to available', async () => {
        await seedProduct(1);
        const { id } = await reserveOne();

        const cancelled = await service.cancel(id);

        expect(cancelled.status).toBe(ReservationStatus.Cancelled);
        expect((await stockOf()).available).toBe(1);
      });

      it('lets another user reserve the released item', async () => {
        await seedProduct(1);
        const { id } = await reserveOne();
        await service.cancel(id);

        await expect(
          reserve({ productId: 'p-1', userId: 'bob' }),
        ).resolves.toBeDefined();
      });

      it('cannot reverse a confirmed purchase', async () => {
        await seedProduct(1);
        const { id } = await reserveOne();
        await service.confirm(id);

        await expect(service.cancel(id)).rejects.toThrow(
          InvalidReservationStateError,
        );
        expect((await stockOf()).sold).toBe(1);
      });

      it('is idempotent: a repeated cancel succeeds and releases only once', async () => {
        await seedProduct(2);
        const { id } = await reserveOne();
        await reserveOne();
        await service.cancel(id);

        await expect(service.cancel(id)).resolves.toMatchObject({
          status: ReservationStatus.Cancelled,
        });
        expect((await stockOf()).reserved).toBe(1);
      });
    });

    describe('expiry', () => {
      it('the sweeper expires due reservations and releases their stock', async () => {
        await seedProduct(3);
        const { id: due } = await reserveOne(2);
        clock.advanceBy(HOLD_MS / 2);
        const { id: notDue } = await reserveOne(1);
        clock.advanceBy(HOLD_MS / 2);

        const expiredCount = await service.expireDueReservations();

        expect(expiredCount).toBe(1);
        expect((await service.getById(due)).status).toBe(
          ReservationStatus.Expired,
        );
        expect((await service.getById(notDue)).status).toBe(
          ReservationStatus.Active,
        );
        expect((await stockOf()).available).toBe(2);
      });

      it('the sweeper leaves confirmed and cancelled reservations alone', async () => {
        await seedProduct(3);
        const { id: confirmed } = await reserveOne();
        const { id: cancelled } = await reserveOne();
        await service.confirm(confirmed);
        await service.cancel(cancelled);
        clock.advanceBy(HOLD_MS * 2);

        await expect(service.expireDueReservations()).resolves.toBe(0);
        const product = await stockOf();
        expect(product.sold).toBe(1);
        expect(product.available).toBe(2);
      });

      it('a new reservation reclaims expired stock even if the sweeper has not run yet', async () => {
        await seedProduct(1);
        const { id: stale } = await reserveOne();
        clock.advanceBy(HOLD_MS);

        const fresh = await reserve({
          productId: 'p-1',
          userId: 'bob',
        });

        expect(fresh.status).toBe(ReservationStatus.Active);
        expect((await service.getById(stale)).status).toBe(
          ReservationStatus.Expired,
        );
        expect((await stockOf()).reserved).toBe(1);
      });

      it('persists reclaimed stock even when the new request still cannot be met', async () => {
        await seedProduct(2);
        await reserveOne(); // will lapse
        clock.advanceBy(HOLD_MS / 2);
        await reserveOne(); // still active
        clock.advanceBy(HOLD_MS / 2);

        await expect(reserveOne(2)).rejects.toThrow(InsufficientStockError);

        const product = await stockOf();
        expect(product.reserved).toBe(1);
        expect(product.available).toBe(1);
      });

      it('still rejects when no expired stock can be reclaimed', async () => {
        await seedProduct(1);
        await reserveOne();
        clock.advanceBy(HOLD_MS - 1);

        await expect(
          reserve({ productId: 'p-1', userId: 'bob' }),
        ).rejects.toThrow(InsufficientStockError);
      });
    });

    it('getById fails for an unknown reservation', async () => {
      await expect(service.getById('missing')).rejects.toThrow(
        ReservationNotFoundError,
      );
    });
  });

  describe('Idempotency-Key on reserve', () => {
    const reserveWithKey = (
      idempotencyKey: string,
      overrides: {
        productId?: string;
        userId?: string;
        quantity?: number;
      } = {},
    ) =>
      reserve({
        productId: 'p-1',
        userId: 'alice',
        quantity: 1,
        idempotencyKey,
        ...overrides,
      });

    it('a repeated request returns the original reservation and holds stock once', async () => {
      await seedProduct(5);

      const first = await reserveWithKey('click-1');
      const second = await reserveWithKey('click-1');

      expect(second.id).toBe(first.id);
      expect((await stockOf()).reserved).toBe(1);
    });

    it('returns the current state of the original reservation', async () => {
      await seedProduct(5);
      const first = await reserveWithKey('click-1');
      await service.confirm(first.id);

      const replay = await reserveWithKey('click-1');

      expect(replay.id).toBe(first.id);
      expect(replay.status).toBe(ReservationStatus.Confirmed);
      expect(await stockOf()).toMatchObject({ sold: 1, reserved: 0 });
    });

    it('replays even when stock has since run out', async () => {
      await seedProduct(1);
      const first = await reserveWithKey('click-1');

      await expect(reserveWithKey('click-1')).resolves.toMatchObject({
        id: first.id,
      });
    });

    it('rejects the same key reused for a different product or quantity', async () => {
      await seedProduct(5);
      await seedProduct(5, 'p-2');
      await reserveWithKey('click-1');

      await expect(reserveWithKey('click-1', { quantity: 2 })).rejects.toThrow(
        IdempotencyKeyMismatchError,
      );
      await expect(
        reserveWithKey('click-1', { productId: 'p-2' }),
      ).rejects.toThrow(IdempotencyKeyMismatchError);
      expect((await stockOf()).reserved).toBe(1);
      expect((await stockOf('p-2')).reserved).toBe(0);
    });

    it('scopes keys per user', async () => {
      await seedProduct(5);

      const alice = await reserveWithKey('click-1', { userId: 'alice' });
      const bob = await reserveWithKey('click-1', { userId: 'bob' });

      expect(bob.id).not.toBe(alice.id);
      expect((await stockOf()).reserved).toBe(2);
    });

    it('a failed attempt does not burn the key', async () => {
      await seedProduct(1);
      const blocker = await reserveWithKey('other', { userId: 'bob' });

      await expect(reserveWithKey('click-1')).rejects.toThrow(
        InsufficientStockError,
      );
      await service.cancel(blocker.id);

      await expect(reserveWithKey('click-1')).resolves.toMatchObject({
        status: ReservationStatus.Active,
      });
    });

    it('different keys from the same user are separate purchases', async () => {
      await seedProduct(5);

      const first = await reserveWithKey('click-1');
      const second = await reserveWithKey('click-2');

      expect(second.id).not.toBe(first.id);
      expect((await stockOf()).reserved).toBe(2);
    });
  });
});
