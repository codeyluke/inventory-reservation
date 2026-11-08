/**
 * Domain errors carry a stable, machine-readable `code` so the HTTP layer can
 * map them to status codes without the domain knowing anything about HTTP.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidArgumentError extends DomainError {
  readonly code = 'INVALID_ARGUMENT';
}

export class InvalidQuantityError extends DomainError {
  readonly code = 'INVALID_QUANTITY';

  constructor(quantity: number) {
    super(`Quantity must be a positive integer, received ${quantity}.`);
  }
}

export class ProductNotFoundError extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor(productId: string) {
    super(`Product ${productId} was not found.`);
  }
}

export class InsufficientStockError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';

  constructor(
    readonly productId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Cannot reserve ${requested} unit(s) of product ${productId}: only ${available} available.`,
    );
  }
}

export class ReservationNotFoundError extends DomainError {
  readonly code = 'RESERVATION_NOT_FOUND';

  constructor(reservationId: string) {
    super(`Reservation ${reservationId} was not found.`);
  }
}

export class ReservationExpiredError extends DomainError {
  readonly code = 'RESERVATION_EXPIRED';

  constructor(reservationId: string) {
    super(`Reservation ${reservationId} has expired.`);
  }
}

export class InvalidReservationStateError extends DomainError {
  readonly code = 'INVALID_RESERVATION_STATE';

  constructor(reservationId: string, status: string, action: string) {
    super(`Cannot ${action} reservation ${reservationId}: it is ${status}.`);
  }
}

export class IdempotencyKeyMismatchError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_MISMATCH';

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" was already used for a different reservation request.`,
    );
  }
}
