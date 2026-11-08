import { Product } from '../domain/product';
import { Reservation, ReservationStatus } from '../domain/reservation';

export interface ProductResponse {
  id: string;
  name: string;
  totalStock: number;
  sold: number;
  reserved: number;
  available: number;
}

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

export const toProductResponse = (product: Product): ProductResponse => ({
  id: product.id,
  name: product.name,
  totalStock: product.totalStock,
  sold: product.sold,
  reserved: product.reserved,
  available: product.available,
});

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
