/**
 * Abstraction over "now" so time-dependent rules (reservation expiry) can be
 * tested deterministically instead of sleeping for two minutes.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
