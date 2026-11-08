import { InvalidArgumentError, InvalidQuantityError } from './errors';

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
}

export interface CreateReservationProps {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  now: Date;
  holdDurationMs: number;
}

/** A temporary hold on stock for one user. */
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
    );
  }

  get status(): ReservationStatus {
    return this.currentStatus;
  }

  get updatedAt(): Date {
    return new Date(this.lastUpdatedAt);
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
    };
  }
}
