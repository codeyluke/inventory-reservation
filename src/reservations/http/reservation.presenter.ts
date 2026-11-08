import { Reservation, ReservationStatus } from '../domain/reservation';

export interface ReservationResponse {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
}

export const toReservationResponse = (
  reservation: Reservation,
): ReservationResponse => ({
  id: reservation.id,
  productId: reservation.productId,
  userId: reservation.userId,
  quantity: reservation.quantity,
  status: reservation.status,
  createdAt: reservation.createdAt.toISOString(),
  expiresAt: reservation.expiresAt.toISOString(),
  updatedAt: reservation.updatedAt.toISOString(),
});
