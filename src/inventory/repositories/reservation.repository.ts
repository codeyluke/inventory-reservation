import { Reservation } from '../domain/reservation';

export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');

/** Persistence port for reservations. */
export interface ReservationRepository {
  findById(id: string): Promise<Reservation | null>;
  /** The reservation a user created with this idempotency key, if any. */
  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<Reservation | null>;
  save(reservation: Reservation): Promise<void>;
  /** ACTIVE reservations whose hold window has elapsed at `now`. */
  findDueForExpiry(now: Date, productId?: string): Promise<Reservation[]>;
}
