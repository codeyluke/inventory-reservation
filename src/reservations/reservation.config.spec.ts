import { loadReservationConfig } from './reservation.config';

describe('loadReservationConfig', () => {
  it('defaults to a 2 minute hold and a 1 second sweep', () => {
    expect(loadReservationConfig({})).toEqual({
      holdDurationMs: 120_000,
      expirySweepIntervalMs: 1_000,
    });
  });

  it('reads overrides from the environment', () => {
    expect(
      loadReservationConfig({
        RESERVATION_HOLD_SECONDS: '30',
        EXPIRY_SWEEP_INTERVAL_MS: '250',
      }),
    ).toEqual({ holdDurationMs: 30_000, expirySweepIntervalMs: 250 });
  });

  it.each(['0', '-5', 'abc', '1.5'])(
    'fails fast on an invalid hold of %p',
    (value) => {
      expect(() =>
        loadReservationConfig({ RESERVATION_HOLD_SECONDS: value }),
      ).toThrow(/RESERVATION_HOLD_SECONDS/);
    },
  );
});
