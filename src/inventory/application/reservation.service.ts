import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock/clock';
import {
  ProductNotFoundError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '../domain/errors';
import { Product } from '../domain/product';
import { Reservation } from '../domain/reservation';
import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from '../repositories/product.repository';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../repositories/reservation.repository';
import {
  RESERVATION_CONFIG,
  type ReservationConfig,
} from '../reservation.config';

export interface ReserveCommand {
  productId: string;
  userId: string;
  quantity?: number;
}

/**
 * Application service orchestrating the reservation lifecycle. Each use case
 * changes a Reservation and its Product together so that
 *   product.reserved === sum(quantity of ACTIVE reservations)
 *   product.sold     === sum(quantity of CONFIRMED reservations)
 * always holds.
 */
@Injectable()
export class ReservationService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RESERVATION_CONFIG) private readonly config: ReservationConfig,
  ) {}

  async reserve(command: ReserveCommand): Promise<Reservation> {
    const quantity = command.quantity ?? 1;
    const now = this.clock.now();
    const product = await this.loadProduct(command.productId);

    // Lazily reclaim stock from holds that have lapsed but have not been swept
    // yet, so availability is exact rather than "up to one sweep interval" stale.
    if (product.available < quantity) {
      await this.expireDueFor(product, now);
    }

    product.reserve(quantity);
    const reservation = Reservation.create({
      id: randomUUID(),
      productId: product.id,
      userId: command.userId,
      quantity,
      now,
      holdDurationMs: this.config.holdDurationMs,
    });

    await this.reservations.save(reservation);
    await this.products.save(product);
    return reservation;
  }

  async confirm(reservationId: string): Promise<Reservation> {
    const reservation = await this.loadReservation(reservationId);
    const product = await this.loadProduct(reservation.productId);
    const now = this.clock.now();

    if (reservation.isDueForExpiry(now)) {
      await this.expire(reservation, product, now);
      throw new ReservationExpiredError(reservationId);
    }

    if (!reservation.confirm(now)) {
      return reservation; // already confirmed: idempotent replay
    }
    product.commit(reservation.quantity);
    await this.persist(reservation, product);
    return reservation;
  }

  async cancel(reservationId: string): Promise<Reservation> {
    const reservation = await this.loadReservation(reservationId);
    const product = await this.loadProduct(reservation.productId);
    const now = this.clock.now();

    if (reservation.isDueForExpiry(now)) {
      await this.expire(reservation, product, now);
      throw new ReservationExpiredError(reservationId);
    }

    if (!reservation.cancel(now)) {
      return reservation; // already cancelled: idempotent replay
    }
    product.release(reservation.quantity);
    await this.persist(reservation, product);
    return reservation;
  }

  getById(reservationId: string): Promise<Reservation> {
    return this.loadReservation(reservationId);
  }

  /** Expires every lapsed reservation. Returns how many were expired. */
  async expireDueReservations(): Promise<number> {
    const due = await this.reservations.findDueForExpiry(this.clock.now());
    let expired = 0;
    for (const candidate of due) {
      const reservation = await this.loadReservation(candidate.id);
      const now = this.clock.now();
      if (!reservation.isDueForExpiry(now)) {
        continue; // confirmed or cancelled since the scan
      }
      const product = await this.loadProduct(reservation.productId);
      await this.expire(reservation, product, now);
      expired += 1;
    }
    return expired;
  }

  private async expireDueFor(product: Product, now: Date): Promise<void> {
    const due = await this.reservations.findDueForExpiry(now, product.id);
    for (const reservation of due) {
      reservation.expire(now);
      product.release(reservation.quantity);
      await this.reservations.save(reservation);
    }
    if (due.length > 0) {
      // Persist the reclaimed stock now: the caller may still fail with
      // InsufficientStockError, and the expiries must not be lost with it.
      await this.products.save(product);
    }
  }

  private async expire(
    reservation: Reservation,
    product: Product,
    now: Date,
  ): Promise<void> {
    reservation.expire(now);
    product.release(reservation.quantity);
    await this.persist(reservation, product);
  }

  private async persist(
    reservation: Reservation,
    product: Product,
  ): Promise<void> {
    await this.reservations.save(reservation);
    await this.products.save(product);
  }

  private async loadReservation(reservationId: string): Promise<Reservation> {
    const reservation = await this.reservations.findById(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }
    return reservation;
  }

  private async loadProduct(productId: string): Promise<Product> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }
    return product;
  }
}
