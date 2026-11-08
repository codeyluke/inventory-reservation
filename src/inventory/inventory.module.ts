import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../common/clock/clock';
import { KeyedMutex } from '../common/concurrency/keyed-mutex';
import { LOCK_MANAGER } from '../common/concurrency/lock-manager';
import { ProductService } from './application/product.service';
import { ReservationExpiryScheduler } from './application/reservation-expiry.scheduler';
import { ReservationService } from './application/reservation.service';
import { ProductsController } from './http/products.controller';
import { ReservationsController } from './http/reservations.controller';
import { InMemoryProductRepository } from './repositories/in-memory-product.repository';
import { InMemoryReservationRepository } from './repositories/in-memory-reservation.repository';
import { PRODUCT_REPOSITORY } from './repositories/product.repository';
import { RESERVATION_REPOSITORY } from './repositories/reservation.repository';
import {
  loadReservationConfig,
  RESERVATION_CONFIG,
} from './reservation.config';

/**
 * Wires ports to adapters. Swapping storage (e.g. MySQL) or the lock (e.g.
 * Redis) means changing a provider here; the services are untouched.
 */
@Module({
  controllers: [ProductsController, ReservationsController],
  providers: [
    ProductService,
    ReservationService,
    ReservationExpiryScheduler,
    { provide: PRODUCT_REPOSITORY, useClass: InMemoryProductRepository },
    {
      provide: RESERVATION_REPOSITORY,
      useClass: InMemoryReservationRepository,
    },
    { provide: LOCK_MANAGER, useFactory: () => new KeyedMutex() },
    { provide: CLOCK, useFactory: () => new SystemClock() },
    { provide: RESERVATION_CONFIG, useFactory: () => loadReservationConfig() },
  ],
})
export class InventoryModule {}
