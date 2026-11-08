import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { DomainExceptionFilter } from './common/http/domain-exception.filter';
import { createValidationPipe } from './common/http/validation.pipe';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  providers: [
    // Registered here (not in main.ts) so tests get the same behaviour.
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
