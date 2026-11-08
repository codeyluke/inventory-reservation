import { Module } from '@nestjs/common';
import { ProductService } from './application/product.service';
import { ProductsController } from './http/products.controller';
import { InMemoryProductRepository } from './repositories/in-memory-product.repository';
import { PRODUCT_REPOSITORY } from './repositories/product.repository';

/**
 * Owns products and their stock counters.
 *
 * Exports PRODUCT_REPOSITORY so other modules move stock only through its
 * atomic operations (reserveStock / commitStock / releaseStock).
 */
@Module({
  controllers: [ProductsController],
  providers: [
    ProductService,
    { provide: PRODUCT_REPOSITORY, useClass: InMemoryProductRepository },
  ],
  exports: [PRODUCT_REPOSITORY],
})
export class ProductsModule {}
