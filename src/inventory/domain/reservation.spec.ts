import {
  InvalidArgumentError,
  InvalidQuantityError,
  InvalidReservationStateError,
  ReservationExpiredError,
} from './errors';
import { Reservation, ReservationStatus } from './reservation';

const HOLD_MS = 120_000;
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (msAfterStart: number) => new Date(T0.getTime() + msAfterStart);

const createReservation = (quantity = 1) =>
  Reservation.create({
    id: 'r-1',
    productId: 'p-1',
    userId: 'alice',
    quantity,
    now: T0,
    holdDurationMs: HOLD_MS,
  });

describe('Reservation', () => {
  describe('create', () => {
    it('starts ACTIVE and expires after the hold duration', () => {
      const reservation = createReservation();

      expect(reservation.status).toBe(ReservationStatus.Active);
      expect(reservation.expiresAt).toEqual(at(HOLD_MS));
    });

    it.each([0, -2, 1.5])('rejects a quantity of %p', (quantity) => {
      expect(() => createReservation(quantity)).toThrow(InvalidQuantityError);
    });

    it('rejects a blank user id', () => {
      expect(() =>
        Reservation.create({
          id: 'r-1',
          productId: 'p-1',
          userId: ' ',
          quantity: 1,
          now: T0,
          holdDurationMs: HOLD_MS,
        }),
      ).toThrow(InvalidArgumentError);
    });
  });

  describe('isDueForExpiry', () => {
    it('is false before the deadline and true from the deadline onwards', () => {
      const reservation = createReservation();

      expect(reservation.isDueForExpiry(at(HOLD_MS - 1))).toBe(false);
      expect(reservation.isDueForExpiry(at(HOLD_MS))).toBe(true);
    });

    it('is false once the reservation is no longer active', () => {
      const reservation = createReservation();
      reservation.confirm(at(1));

      expect(reservation.isDueForExpiry(at(HOLD_MS * 2))).toBe(false);
    });
  });

  describe('confirm', () => {
    it('moves ACTIVE -> CONFIRMED within the hold window', () => {
      const reservation = createReservation();

      reservation.confirm(at(HOLD_MS - 1));

      expect(reservation.status).toBe(ReservationStatus.Confirmed);
      expect(reservation.updatedAt).toEqual(at(HOLD_MS - 1));
    });

    it('fails once the hold window has elapsed, even before the sweeper runs', () => {
      const reservation = createReservation();

      expect(() => reservation.confirm(at(HOLD_MS))).toThrow(
        ReservationExpiredError,
      );
      expect(reservation.status).toBe(ReservationStatus.Active);
    });

    it('reports whether it changed anything', () => {
      expect(createReservation().confirm(at(1))).toBe(true);
    });

    it('is idempotent: confirming again is a no-op that reports no change', () => {
      const reservation = createReservation();
      reservation.confirm(at(1));

      expect(reservation.confirm(at(2))).toBe(false);
      expect(reservation.status).toBe(ReservationStatus.Confirmed);
      expect(reservation.updatedAt).toEqual(at(1));
    });

    it('replaying confirm after the hold window still succeeds once confirmed', () => {
      const reservation = createReservation();
      reservation.confirm(at(1));

      expect(reservation.confirm(at(HOLD_MS * 10))).toBe(false);
    });

    it('fails on a cancelled reservation', () => {
      const reservation = createReservation();
      reservation.cancel(at(1));

      expect(() => reservation.confirm(at(2))).toThrow(
        InvalidReservationStateError,
      );
    });
  });

  describe('cancel', () => {
    it('moves ACTIVE -> CANCELLED', () => {
      const reservation = createReservation();

      expect(reservation.cancel(at(1))).toBe(true);
      expect(reservation.status).toBe(ReservationStatus.Cancelled);
    });

    it('is idempotent: cancelling again is a no-op that reports no change', () => {
      const reservation = createReservation();
      reservation.cancel(at(1));

      expect(reservation.cancel(at(2))).toBe(false);
      expect(reservation.status).toBe(ReservationStatus.Cancelled);
      expect(reservation.updatedAt).toEqual(at(1));
    });

    it('cannot reverse a confirmed purchase', () => {
      const reservation = createReservation();
      reservation.confirm(at(1));

      expect(() => reservation.cancel(at(2))).toThrow(
        InvalidReservationStateError,
      );
      expect(reservation.status).toBe(ReservationStatus.Confirmed);
    });

    it('fails once the hold window has elapsed', () => {
      const reservation = createReservation();

      expect(() => reservation.cancel(at(HOLD_MS))).toThrow(
        ReservationExpiredError,
      );
    });
  });

  describe('expire', () => {
    it('moves ACTIVE -> EXPIRED once due', () => {
      const reservation = createReservation();

      reservation.expire(at(HOLD_MS));

      expect(reservation.status).toBe(ReservationStatus.Expired);
    });

    it('refuses to expire a reservation that is not yet due', () => {
      const reservation = createReservation();

      expect(() => reservation.expire(at(HOLD_MS - 1))).toThrow(
        InvalidReservationStateError,
      );
    });

    it('refuses to expire a confirmed reservation', () => {
      const reservation = createReservation();
      reservation.confirm(at(1));

      expect(() => reservation.expire(at(HOLD_MS))).toThrow(
        InvalidReservationStateError,
      );
    });

    it('reports EXPIRED rather than a generic state error on later actions', () => {
      const reservation = createReservation();
      reservation.expire(at(HOLD_MS));

      expect(() => reservation.confirm(at(HOLD_MS + 1))).toThrow(
        ReservationExpiredError,
      );
      expect(() => reservation.cancel(at(HOLD_MS + 1))).toThrow(
        ReservationExpiredError,
      );
    });
  });
});
