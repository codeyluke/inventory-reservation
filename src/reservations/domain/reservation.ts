import {
  InvalidArgumentError,
  InvalidQuantityError,
} from '../../core/errors/domain-error';
import {
  InvalidReservationStateError,
  ReservationExpiredError,
} from './reservation.errors';

export enum ReservationStatus {
  Active = 'ACTIVE',
  Confirmed = 'CONFIRMED',
  Cancelled = 'CANCELLED',
  Expired = 'EXPIRED',
}

export interface ReservationSnapshot {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: Date;
  expiresAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
}

export interface CreateReservationProps {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  now: Date;
  holdDurationMs: number;
  /** Client-supplied key that makes repeated reserve requests safe. */
  idempotencyKey: string;
}

/**
 * A temporary hold on stock for one user.
 *
 *   ACTIVE ──confirm──▶ CONFIRMED   (final: purchases cannot be reversed)
 *     │ ├───cancel───▶ CANCELLED
 *     │ └───expire───▶ EXPIRED     (hold window elapsed)
 *
 * The deadline is enforced by the entity itself: once `now >= expiresAt` an
 * ACTIVE reservation can no longer be confirmed or cancelled, even if the
 * background sweeper has not marked it EXPIRED yet. Stock bookkeeping lives
 * on Product; the service applies both changes together.
 *
 * confirm and cancel are idempotent: repeating a transition that already
 * happened is a no-op (returns false), so client retries and duplicate
 * payment webhooks get the same answer instead of an error. Conflicting
 * transitions (confirm a CANCELLED one, cancel a CONFIRMED one) still fail.
 */
export class Reservation {
  private constructor(
    readonly id: string,
    readonly productId: string,
    readonly userId: string,
    readonly quantity: number,
    private currentStatus: ReservationStatus,
    readonly createdAt: Date,
    readonly expiresAt: Date,
    private lastUpdatedAt: Date,
    readonly idempotencyKey: string,
  ) {}

  static create(props: CreateReservationProps): Reservation {
    if (!Number.isInteger(props.quantity) || props.quantity <= 0) {
      throw new InvalidQuantityError(props.quantity);
    }
    if (!props.userId.trim()) {
      throw new InvalidArgumentError('User id is required.');
    }
    if (!Number.isFinite(props.holdDurationMs) || props.holdDurationMs <= 0) {
      throw new InvalidArgumentError('Hold duration must be positive.');
    }
    if (!props.idempotencyKey.trim()) {
      throw new InvalidArgumentError('Idempotency key is required.');
    }
    const now = new Date(props.now);
    return new Reservation(
      props.id,
      props.productId,
      props.userId.trim(),
      props.quantity,
      ReservationStatus.Active,
      now,
      new Date(now.getTime() + props.holdDurationMs),
      now,
      props.idempotencyKey,
    );
  }

  static fromSnapshot(snapshot: ReservationSnapshot): Reservation {
    return new Reservation(
      snapshot.id,
      snapshot.productId,
      snapshot.userId,
      snapshot.quantity,
      snapshot.status,
      new Date(snapshot.createdAt),
      new Date(snapshot.expiresAt),
      new Date(snapshot.updatedAt),
      snapshot.idempotencyKey,
    );
  }

  get status(): ReservationStatus {
    return this.currentStatus;
  }

  get updatedAt(): Date {
    return new Date(this.lastUpdatedAt);
  }

  isDueForExpiry(now: Date): boolean {
    return (
      this.currentStatus === ReservationStatus.Active &&
      now.getTime() >= this.expiresAt.getTime()
    );
  }

  /** Returns true if the reservation changed, false for an idempotent replay. */
  confirm(now: Date): boolean {
    return this.transition(ReservationStatus.Confirmed, 'confirm', now);
  }

  /** Returns true if the reservation changed, false for an idempotent replay. */
  cancel(now: Date): boolean {
    return this.transition(ReservationStatus.Cancelled, 'cancel', now);
  }

  expire(now: Date): void {
    if (!this.isDueForExpiry(now)) {
      throw new InvalidReservationStateError(
        this.id,
        this.describeState(now),
        'expire',
      );
    }
    this.transitionTo(ReservationStatus.Expired, now);
  }

  toSnapshot(): ReservationSnapshot {
    return {
      id: this.id,
      productId: this.productId,
      userId: this.userId,
      quantity: this.quantity,
      status: this.currentStatus,
      createdAt: new Date(this.createdAt),
      expiresAt: new Date(this.expiresAt),
      updatedAt: new Date(this.lastUpdatedAt),
      idempotencyKey: this.idempotencyKey,
    };
  }

  private transition(
    target: ReservationStatus,
    action: string,
    now: Date,
  ): boolean {
    if (this.currentStatus === target) {
      return false; // already done: idempotent replay
    }
    this.assertActionable(action, now);
    this.transitionTo(target, now);
    return true;
  }

  private assertActionable(action: string, now: Date): void {
    if (
      this.currentStatus === ReservationStatus.Expired ||
      this.isDueForExpiry(now)
    ) {
      throw new ReservationExpiredError(this.id);
    }
    if (this.currentStatus !== ReservationStatus.Active) {
      throw new InvalidReservationStateError(
        this.id,
        this.currentStatus,
        action,
      );
    }
  }

  private describeState(now: Date): string {
    return this.currentStatus === ReservationStatus.Active
      ? `ACTIVE until ${this.expiresAt.toISOString()} (now ${now.toISOString()})`
      : this.currentStatus;
  }

  private transitionTo(status: ReservationStatus, now: Date): void {
    this.currentStatus = status;
    this.lastUpdatedAt = new Date(now);
  }
}
