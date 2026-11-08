export const RESERVATION_CONFIG = Symbol('RESERVATION_CONFIG');

export interface ReservationConfig {
  /** How long a reservation holds stock before it expires. */
  holdDurationMs: number;
}

const DEFAULT_HOLD_SECONDS = 120;

const readPositiveInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}".`);
  }
  return value;
};

export const loadReservationConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ReservationConfig => ({
  holdDurationMs:
    readPositiveInteger(env, 'RESERVATION_HOLD_SECONDS', DEFAULT_HOLD_SECONDS) *
    1000,
});
