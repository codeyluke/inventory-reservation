import { Injectable } from '@nestjs/common';
import { ProductNotFoundError } from '../domain/errors';
import { Product, ProductSnapshot } from '../domain/product';
import { ProductRepository } from './product.repository';

/**
 * In-memory adapter backed by a Map.
 *
 * Stores immutable snapshots rather than live objects, so callers get their
 * own copy (like a row read from a database) and changes only become visible
 * after they are written back.
 *
 * Atomicity of the `*Stock` operations: each one reads, validates (via the
 * Product aggregate) and writes the snapshot synchronously, with no `await`
 * in between. Node never interleaves other JavaScript inside a synchronous
 * block, so no other request can observe or modify the product mid-update.
 * This is the in-process equivalent of a conditional UPDATE in SQL.
 */
@Injectable()
export class InMemoryProductRepository implements ProductRepository {
  private readonly products = new Map<string, ProductSnapshot>();

  async findById(id: string): Promise<Product | null> {
    const snapshot = this.products.get(id);
    return Promise.resolve(snapshot ? Product.fromSnapshot(snapshot) : null);
  }

  async findAll(): Promise<Product[]> {
    return Promise.resolve(
      [...this.products.values()].map((snapshot) =>
        Product.fromSnapshot(snapshot),
      ),
    );
  }

  async save(product: Product): Promise<void> {
    this.products.set(product.id, product.toSnapshot());
    return Promise.resolve();
  }

  reserveStock(productId: string, quantity: number): Promise<Product> {
    return this.atomicUpdate(productId, (product) => product.reserve(quantity));
  }

  releaseStock(productId: string, quantity: number): Promise<Product> {
    return this.atomicUpdate(productId, (product) => product.release(quantity));
  }

  commitStock(productId: string, quantity: number): Promise<Product> {
    return this.atomicUpdate(productId, (product) => product.commit(quantity));
  }

  /** Read-validate-write with no await inside: indivisible on Node's thread. */
  private atomicUpdate(
    productId: string,
    mutate: (product: Product) => void,
  ): Promise<Product> {
    try {
      const snapshot = this.products.get(productId);
      if (!snapshot) {
        throw new ProductNotFoundError(productId);
      }
      const product = Product.fromSnapshot(snapshot);
      mutate(product); // throws (and writes nothing) if an invariant would break
      this.products.set(productId, product.toSnapshot());
      return Promise.resolve(product);
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }
}
