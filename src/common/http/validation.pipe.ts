import { BadRequestException, ValidationPipe } from '@nestjs/common';

/**
 * Strict request validation: unknown properties are rejected, payloads are
 * transformed into DTO instances, and errors share the API's error shape.
 */
export const createValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: errors.flatMap((error) =>
          Object.values(error.constraints ?? {}),
        ),
      }),
  });
