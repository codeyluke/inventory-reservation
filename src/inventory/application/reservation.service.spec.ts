import { FakeClock } from '../../testing/fake-clock';
import {
  InsufficientStockError,
  InvalidQuantityError,
  ProductNotFoundError,
} from '../domain/errors';
import { Product } from '../domain/product';
import { ReservationStatus } from '../domain/reservation';
import { InMemoryProductRepository } from '../repositories/in-memory-product.repository';
import { InMemoryReservationRepository } from '../repositories/in-memory-reservation.repository';
import { ReservationService } from './reservation.service';

const HOLD_MS = 2 * 60 * 1000;

describe('ReservationService', () => {
  let products: InMemoryProductRepository;
  let reservations: InMemoryReservationRepository;
  let clock: FakeClock;
  let service: ReservationService;

  const seedProduct = async (totalStock: number, id = 'p-1') => {
    await products.save(Product.create({ id, name: 'Sneaker', totalStock }));
  };

  const stockOf = async (id = 'p-1') => (await products.findById(id))!;

  beforeEach(() => {
    products = new InMemoryProductRepository();
    reservations = new InMemoryReservationRepository();
    clock = new FakeClock();
    service = new ReservationService(products, reservations, clock, {
      holdDurationMs: HOLD_MS,
    });
  });

  describe('Level 1: reserve', () => {
    it('creates an active reservation that holds stock for 2 minutes', async () => {
      await seedProduct(5);

      const reservation = await service.reserve({
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

      const reservation = await service.reserve({
        productId: 'p-1',
        userId: 'alice',
      });

      expect(reservation.quantity).toBe(1);
    });

    it('stock = 1: user A succeeds, user B fails', async () => {
      await seedProduct(1);

      await expect(
        service.reserve({ productId: 'p-1', userId: 'A' }),
      ).resolves.toBeDefined();
      await expect(
        service.reserve({ productId: 'p-1', userId: 'B' }),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('rejects a reservation exceeding available stock', async () => {
      await seedProduct(3);

      await expect(
        service.reserve({ productId: 'p-1', userId: 'alice', quantity: 4 }),
      ).rejects.toThrow(InsufficientStockError);
      expect((await stockOf()).available).toBe(3);
    });

    it('rejects an unknown product', async () => {
      await expect(
        service.reserve({ productId: 'missing', userId: 'alice' }),
      ).rejects.toThrow(ProductNotFoundError);
    });

    it('rejects an invalid quantity without touching stock', async () => {
      await seedProduct(3);

      await expect(
        service.reserve({ productId: 'p-1', userId: 'alice', quantity: 0 }),
      ).rejects.toThrow(InvalidQuantityError);
      expect((await stockOf()).available).toBe(3);
    });
  });
});
