import { Reservation } from '../domain/reservation';

export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');

/** Persistence port for reservations. */
export interface ReservationRepository {
  findById(id: string): Promise<Reservation | null>;
  save(reservation: Reservation): Promise<void>;
}
