import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { ProductsModule } from './products/products.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [CoreModule, ProductsModule, ReservationsModule],
})
export class AppModule {}
