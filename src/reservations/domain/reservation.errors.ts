import { DomainError } from '../../core/errors/domain-error';

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
