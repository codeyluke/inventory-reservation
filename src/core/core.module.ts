import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { CLOCK, SystemClock } from './clock/clock';
import { KeyedMutex } from './concurrency/keyed-mutex';
import { LOCK_MANAGER } from './concurrency/lock-manager';
import { DomainExceptionFilter } from './http/domain-exception.filter';
import { createValidationPipe } from './http/validation.pipe';

/**
 * Cross-cutting infrastructure shared by every feature module.
 *
 * Global and provided exactly once on purpose: the lock only works if every
 * caller contends on the SAME KeyedMutex instance. If a feature module
 * declared its own LOCK_MANAGER, it would lock independently and silently
 * reintroduce the race.
 */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useFactory: () => new SystemClock() },
    { provide: LOCK_MANAGER, useFactory: () => new KeyedMutex() },
    // Registered as app-wide providers (not in main.ts) so tests get the
    // same validation and error mapping as production.
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
  exports: [CLOCK, LOCK_MANAGER],
})
export class CoreModule {}
