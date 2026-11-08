import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../inventory/domain/errors';

/** Domain error code -> HTTP status. Unlisted codes fall back to 400. */
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  INVALID_ARGUMENT: HttpStatus.BAD_REQUEST,
  INVALID_QUANTITY: HttpStatus.BAD_REQUEST,
  PRODUCT_NOT_FOUND: HttpStatus.NOT_FOUND,
  RESERVATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSUFFICIENT_STOCK: HttpStatus.CONFLICT,
  INVALID_RESERVATION_STATE: HttpStatus.CONFLICT,
  RESERVATION_EXPIRED: HttpStatus.CONFLICT,
  IDEMPOTENCY_KEY_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * Translates domain errors into HTTP responses, keeping the domain free of
 * transport concerns. Body shape: { statusCode, code, message }.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const statusCode = STATUS_BY_CODE[error.code] ?? HttpStatus.BAD_REQUEST;
    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      code: error.code,
      message: error.message,
    });
  }
}
