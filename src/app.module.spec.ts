import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';
import { CoreModule } from './core/core.module';
import { KeyedMutex } from './core/concurrency/keyed-mutex';
import { LOCK_MANAGER } from './core/concurrency/lock-manager';
import { ProductService } from './products/application/product.service';
import { ProductsModule } from './products/products.module';
import { PRODUCT_REPOSITORY } from './products/repositories/product.repository';
import { ReservationService } from './reservations/application/reservation.service';

/**
 * Guards the module wiring. Both checks fail silently at runtime if broken:
 * a second lock instance reintroduces the race, and a second product store
 * makes reservations see different stock than the products API.
 */
describe('AppModule wiring', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterAll(() => moduleRef.close());

  it('provides exactly one shared lock, used by the reservation service', () => {
    // Compare with the instance CoreModule owns, not whichever one the
    // container happens to find first.
    const lock = moduleRef
      .select(CoreModule)
      .get<unknown>(LOCK_MANAGER, { strict: true });
    const reservationService = moduleRef.get(ReservationService);

    expect(lock).toBeInstanceOf(KeyedMutex);
    expect(reservationService['lock']).toBe(lock);
  });

  it('products and reservations share the same product store', () => {
    const repository = moduleRef
      .select(ProductsModule)
      .get<unknown>(PRODUCT_REPOSITORY, { strict: true });

    expect(moduleRef.get(ProductService)['products']).toBe(repository);
    expect(moduleRef.get(ReservationService)['products']).toBe(repository);
  });
});
