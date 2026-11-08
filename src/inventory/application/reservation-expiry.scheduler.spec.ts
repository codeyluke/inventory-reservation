import { Logger } from '@nestjs/common';
import { ReservationExpiryScheduler } from './reservation-expiry.scheduler';
import { ReservationService } from './reservation.service';

describe('ReservationExpiryScheduler', () => {
  const INTERVAL_MS = 1000;
  let expireDueReservations: jest.Mock<Promise<number>, []>;
  let scheduler: ReservationExpiryScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expireDueReservations = jest.fn<Promise<number>, []>().mockResolvedValue(0);
    scheduler = new ReservationExpiryScheduler(
      { expireDueReservations } as unknown as ReservationService,
      { holdDurationMs: 120_000, expirySweepIntervalMs: INTERVAL_MS },
    );
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sweeps on every interval once started', async () => {
    scheduler.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(expireDueReservations).toHaveBeenCalledTimes(3);
  });

  it('stops sweeping when the module is destroyed', async () => {
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('never runs two sweeps at the same time', async () => {
    let finish!: () => void;
    expireDueReservations.mockImplementationOnce(
      () => new Promise<number>((resolve) => (finish = () => resolve(0))),
    );
    scheduler.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(expireDueReservations).toHaveBeenCalledTimes(1);

    finish();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(expireDueReservations).toHaveBeenCalledTimes(2);
  });

  it('keeps running after a failed sweep', async () => {
    expireDueReservations.mockRejectedValueOnce(new Error('boom'));
    scheduler.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(expireDueReservations).toHaveBeenCalledTimes(2);
  });
});
