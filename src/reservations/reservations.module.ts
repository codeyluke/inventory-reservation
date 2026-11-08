import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ReservationExpiryScheduler } from './application/reservation-expiry.scheduler';
import { ReservationService } from './application/reservation.service';
import { ReservationsController } from './http/reservations.controller';
import { InMemoryReservationRepository } from './repositories/in-memory-reservation.repository';
import { RESERVATION_REPOSITORY } from './repositories/reservation.repository';
import {
  loadReservationConfig,
  RESERVATION_CONFIG,
} from './reservation.config';

/**
 * Owns the reservation lifecycle (reserve, confirm, cancel, expire).
 *
 * Depends on ProductsModule for atomic stock changes; products never depend
 * on reservations. CLOCK and LOCK_MANAGER come from the global CoreModule.
 */
@Module({
  imports: [ProductsModule],
  controllers: [ReservationsController],
  providers: [
    ReservationService,
    ReservationExpiryScheduler,
    {
      provide: RESERVATION_REPOSITORY,
      useClass: InMemoryReservationRepository,
    },
    { provide: RESERVATION_CONFIG, useFactory: () => loadReservationConfig() },
  ],
})
export class ReservationsModule {}
