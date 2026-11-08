import { Injectable } from '@nestjs/common';
import {
  Reservation,
  ReservationSnapshot,
  ReservationStatus,
} from '../domain/reservation';
import { ReservationRepository } from './reservation.repository';

/**
 * Snapshot-based in-memory store; see InMemoryProductRepository.
 *
 * Active reservations are tracked in a secondary index so the expiry sweep
 * scans only live holds, not the whole (ever-growing) history.
 */
@Injectable()
export class InMemoryReservationRepository implements ReservationRepository {
  private readonly reservations = new Map<string, ReservationSnapshot>();
  private readonly activeIds = new Set<string>();

  async findById(id: string): Promise<Reservation | null> {
    const snapshot = this.reservations.get(id);
    return Promise.resolve(
      snapshot ? Reservation.fromSnapshot(snapshot) : null,
    );
  }

  async save(reservation: Reservation): Promise<void> {
    this.reservations.set(reservation.id, reservation.toSnapshot());
    if (reservation.status === ReservationStatus.Active) {
      this.activeIds.add(reservation.id);
    } else {
      this.activeIds.delete(reservation.id);
    }
    return Promise.resolve();
  }

  async findDueForExpiry(
    now: Date,
    productId?: string,
  ): Promise<Reservation[]> {
    const due: Reservation[] = [];
    for (const id of this.activeIds) {
      const reservation = Reservation.fromSnapshot(this.reservations.get(id)!);
      const matchesProduct =
        productId === undefined || reservation.productId === productId;
      if (matchesProduct && reservation.isDueForExpiry(now)) {
        due.push(reservation);
      }
    }
    return Promise.resolve(due);
  }
}
