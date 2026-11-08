import { Product } from '../domain/product';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

/**
 * Persistence port for products. Methods are async on purpose: the in-memory
 * adapter could be synchronous, but a real store (MySQL, Redis) is not, and
 * keeping the contract async means the service's concurrency handling is
 * designed for the real world rather than accidentally relying on Node's
 * single-threaded event loop.
 */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findAll(): Promise<Product[]>;
  save(product: Product): Promise<void>;
}
