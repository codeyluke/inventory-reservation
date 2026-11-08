import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  RESERVATION_CONFIG,
  type ReservationConfig,
} from '../reservation.config';
import { ReservationService } from './reservation.service';

/**
 * Periodically expires lapsed reservations so their stock returns to the
 * pool without waiting for the next request on that product.
 *
 * This is a safety net, not the source of truth: the deadline is enforced by
 * the Reservation entity itself, and `reserve` reclaims lapsed holds lazily.
 */
@Injectable()
export class ReservationExpiryScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReservationExpiryScheduler.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly reservationService: ReservationService,
    @Inject(RESERVATION_CONFIG) private readonly config: ReservationConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      this.config.expirySweepIntervalMs,
    );
    // Do not keep the process alive just for the sweeper.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) {
      return; // previous sweep still running; skip rather than overlap
    }
    this.sweeping = true;
    try {
      const expired = await this.reservationService.expireDueReservations();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} reservation(s).`);
      }
    } catch (error) {
      this.logger.error('Reservation expiry sweep failed', error);
    } finally {
      this.sweeping = false;
    }
  }
}
