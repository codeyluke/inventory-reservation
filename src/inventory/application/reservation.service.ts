import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock/clock';
import {
  LOCK_MANAGER,
  type LockManager,
} from '../../common/concurrency/lock-manager';
import {
  InsufficientStockError,
  IdempotencyKeyMismatchError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '../domain/errors';
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
  /**
   * Required client key, unique per purchase attempt. Repeating a request
   * with the same key returns the original reservation.
   */
  idempotencyKey: string;
}

const productLockKey = (productId: string) => `product:${productId}`;
const idempotencyLockKey = (userId: string, idempotencyKey: string) =>
  `idempotency:${JSON.stringify([userId, idempotencyKey])}`;

/**
 * Application service orchestrating the reservation lifecycle.
 *
 * Invariant (per product):
 *   product.reserved === sum(quantity of ACTIVE reservations)
 *   product.sold     === sum(quantity of CONFIRMED reservations)
 *
 * Concurrency strategy: two layers.
 *
 * 1. Atomic stock updates (ProductRepository.*Stock): the availability check
 *    and the counter change are one indivisible step, so stock can never be
 *    oversold, even by a caller that bypasses this service.
 *
 * 2. A per-product lock (LockManager) around every use case: a use case
 *    touches two records (the reservation's status and the product's
 *    counters) across several awaits. Without the lock, two requests can both
 *    read a reservation as ACTIVE and, say, confirm AND cancel it. Locking by
 *    product, not globally, means different products never wait on each other.
 *
 * The lock is not re-entrant: private helpers called from inside a locked
 * section must not try to take it again.
 *
 * Idempotency: confirm/cancel are idempotent by state (see Reservation).
 * reserve requires an idempotency key and is idempotent per (userId, key):
 * the key check and the reservation it creates happen under a lock on that
 * key, so even duplicates arriving at the same instant create one reservation. Lock order is always
 * idempotency key -> product, never the reverse, so the two cannot deadlock.
 */
@Injectable()
export class ReservationService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(LOCK_MANAGER) private readonly lock: LockManager,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RESERVATION_CONFIG) private readonly config: ReservationConfig,
  ) {}

  reserve(command: ReserveCommand): Promise<Reservation> {
    const { idempotencyKey } = command;
    const userId = command.userId.trim();
    return this.lock.runExclusive(
      idempotencyLockKey(userId, idempotencyKey),
      async () => {
        const original = await this.reservations.findByIdempotencyKey(
          userId,
          idempotencyKey,
        );
        if (!original) {
          return this.reserveUnderProductLock(command);
        }
        const sameRequest =
          original.productId === command.productId &&
          original.quantity === (command.quantity ?? 1);
        if (!sameRequest) {
          throw new IdempotencyKeyMismatchError(idempotencyKey);
        }
        return original; // replay: no new hold
      },
    );
  }

  private reserveUnderProductLock(
    command: ReserveCommand,
  ): Promise<Reservation> {
    return this.lock.runExclusive(
      productLockKey(command.productId),
      async () => {
        const now = this.clock.now();
        // Build (and so validate) the reservation before touching stock.
        const reservation = Reservation.create({
          id: randomUUID(),
          productId: command.productId,
          userId: command.userId,
          quantity: command.quantity ?? 1,
          now,
          holdDurationMs: this.config.holdDurationMs,
          idempotencyKey: command.idempotencyKey,
        });

        await this.reserveStockReclaimingExpired(reservation, now);

        try {
          await this.reservations.save(reservation);
        } catch (error) {
          // Compensate so a failed write cannot leak held stock.
          await this.products.releaseStock(
            reservation.productId,
            reservation.quantity,
          );
          throw error;
        }
        return reservation;
      },
    );
  }

  async confirm(reservationId: string): Promise<Reservation> {
    return this.withReservationLock(reservationId, async (reservation, now) => {
      if (!reservation.confirm(now)) {
        return reservation; // already confirmed: idempotent replay
      }
      await this.products.commitStock(
        reservation.productId,
        reservation.quantity,
      );
      await this.reservations.save(reservation);
      return reservation;
    });
  }

  async cancel(reservationId: string): Promise<Reservation> {
    return this.withReservationLock(reservationId, async (reservation, now) => {
      if (!reservation.cancel(now)) {
        return reservation; // already cancelled: idempotent replay
      }
      await this.products.releaseStock(
        reservation.productId,
        reservation.quantity,
      );
      await this.reservations.save(reservation);
      return reservation;
    });
  }

  getById(reservationId: string): Promise<Reservation> {
    return this.loadReservation(reservationId);
  }

  /** Expires every lapsed reservation. Returns how many were expired. */
  async expireDueReservations(): Promise<number> {
    const candidates = await this.reservations.findDueForExpiry(
      this.clock.now(),
    );
    let expired = 0;
    for (const candidate of candidates) {
      const didExpire = await this.lock.runExclusive(
        productLockKey(candidate.productId),
        async () => {
          // Re-read under the lock: it may have been confirmed or cancelled
          // between the scan and acquiring the lock.
          const reservation = await this.loadReservation(candidate.id);
          const now = this.clock.now();
          if (!reservation.isDueForExpiry(now)) {
            return false;
          }
          await this.expire(reservation, now);
          return true;
        },
      );
      expired += didExpire ? 1 : 0;
    }
    return expired;
  }

  /**
   * Runs `action` under the reservation's product lock, against a fresh read
   * of the reservation. Lapsed reservations are expired (releasing stock)
   * instead of acted on.
   */
  private async withReservationLock(
    reservationId: string,
    action: (reservation: Reservation, now: Date) => Promise<Reservation>,
  ): Promise<Reservation> {
    // productId never changes, so it is safe to read before locking.
    const { productId } = await this.loadReservation(reservationId);

    return this.lock.runExclusive(productLockKey(productId), async () => {
      const reservation = await this.loadReservation(reservationId);
      const now = this.clock.now();
      if (reservation.isDueForExpiry(now)) {
        await this.expire(reservation, now);
        throw new ReservationExpiredError(reservationId);
      }
      return action(reservation, now);
    });
  }

  /**
   * Tries to hold stock. If there is not enough, lazily expires lapsed holds
   * on this product (the sweeper may not have run yet) and tries once more,
   * so availability is exact rather than up to one sweep interval stale.
   * Caller must hold the product lock.
   */
  private async reserveStockReclaimingExpired(
    reservation: Reservation,
    now: Date,
  ): Promise<void> {
    const { productId, quantity } = reservation;
    try {
      await this.products.reserveStock(productId, quantity);
    } catch (error) {
      if (!(error instanceof InsufficientStockError)) {
        throw error;
      }
      const lapsed = await this.reservations.findDueForExpiry(now, productId);
      if (lapsed.length === 0) {
        throw error;
      }
      for (const stale of lapsed) {
        await this.expire(stale, now);
      }
      await this.products.reserveStock(productId, quantity);
    }
  }

  /** Caller must hold the product lock. */
  private async expire(reservation: Reservation, now: Date): Promise<void> {
    reservation.expire(now);
    await this.products.releaseStock(
      reservation.productId,
      reservation.quantity,
    );
    await this.reservations.save(reservation);
  }

  private async loadReservation(reservationId: string): Promise<Reservation> {
    const reservation = await this.reservations.findById(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }
    return reservation;
  }
}
