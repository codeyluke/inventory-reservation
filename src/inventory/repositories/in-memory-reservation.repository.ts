import { Injectable } from '@nestjs/common';
import { Reservation, ReservationSnapshot } from '../domain/reservation';
import { ReservationRepository } from './reservation.repository';

/** Snapshot-based in-memory store; see InMemoryProductRepository. */
@Injectable()
export class InMemoryReservationRepository implements ReservationRepository {
  private readonly reservations = new Map<string, ReservationSnapshot>();

  async findById(id: string): Promise<Reservation | null> {
    const snapshot = this.reservations.get(id);
    return Promise.resolve(
      snapshot ? Reservation.fromSnapshot(snapshot) : null,
    );
  }

  async save(reservation: Reservation): Promise<void> {
    this.reservations.set(reservation.id, reservation.toSnapshot());
    return Promise.resolve();
  }
}
