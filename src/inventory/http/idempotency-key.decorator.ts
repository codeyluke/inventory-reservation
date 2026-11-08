import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

const MAX_LENGTH = 255;
// Printable ASCII without spaces, e.g. a UUID.
const ALLOWED = /^[\x21-\x7E]+$/;

const invalid = (message: string) =>
  new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: [message],
  });

/**
 * Validates the required `Idempotency-Key` header. Every reserve request must
 * carry one, so duplicates (double-clicks, retries) can always be detected.
 */
export const parseIdempotencyKey = (
  value: string | string[] | undefined,
): string => {
  if (value === undefined) {
    throw invalid('Idempotency-Key header is required.');
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_LENGTH ||
    !ALLOWED.test(value)
  ) {
    throw invalid(
      `Idempotency-Key must be 1-${MAX_LENGTH} printable characters without spaces.`,
    );
  }
  return value;
};

/** Injects the validated, required `Idempotency-Key` header. */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    parseIdempotencyKey(
      context.switchToHttp().getRequest<Request>().headers['idempotency-key'],
    ),
);
