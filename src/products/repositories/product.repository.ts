import { Product } from '../domain/product';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

/**
 * Persistence port for products.
 *
 * Methods are async on purpose: a real store (MySQL, Redis) is, and keeping
 * the contract async means concurrency is designed for the real world rather
 * than accidentally relying on Node's single-threaded event loop.
 *
 * Stock changes go through the atomic `*Stock` operations, never through a
 * read-modify-`save` round trip. Each one checks the invariant and applies the
 * change as a single indivisible step, the equivalent of
 *
 *   UPDATE products SET reserved = reserved + :qty
 *   WHERE id = :id AND total_stock - sold - reserved >= :qty
 *
 * so concurrent callers can never act on a stale read and oversell.
 */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findAll(): Promise<Product[]>;
  /** Inserts or replaces a product (catalogue management, not stock moves). */
  save(product: Product): Promise<void>;

  /** Atomically moves `quantity` from available to reserved, or throws. */
  reserveStock(productId: string, quantity: number): Promise<Product>;
  /** Atomically returns `quantity` from reserved to available. */
  releaseStock(productId: string, quantity: number): Promise<Product>;
  /** Atomically moves `quantity` from reserved to sold. */
  commitStock(productId: string, quantity: number): Promise<Product>;
}
