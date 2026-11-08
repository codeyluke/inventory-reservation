import { Injectable } from '@nestjs/common';
import { Product, ProductSnapshot } from '../domain/product';
import { ProductRepository } from './product.repository';

/**
 * Stores immutable snapshots rather than live objects, so callers get their
 * own copy (like a row read from a database) and changes only become visible
 * after `save`. This keeps the in-memory store honest about read-modify-write
 * races instead of hiding them behind shared object references.
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
}
