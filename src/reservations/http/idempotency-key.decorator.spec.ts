import { BadRequestException } from '@nestjs/common';
import { parseIdempotencyKey } from './idempotency-key.decorator';

describe('parseIdempotencyKey', () => {
  it('requires the header', () => {
    expect(() => parseIdempotencyKey(undefined)).toThrow(BadRequestException);
  });

  it('accepts a UUID', () => {
    const key = '5f0c1f9e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
    expect(parseIdempotencyKey(key)).toBe(key);
  });

  it.each(['', '   ', 'has space', 'x'.repeat(256)])('rejects %p', (key) => {
    expect(() => parseIdempotencyKey(key)).toThrow(BadRequestException);
  });

  it('rejects a header sent more than once', () => {
    expect(() => parseIdempotencyKey(['a', 'b'])).toThrow(BadRequestException);
  });
});
