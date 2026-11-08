import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProductNotFoundError } from '../domain/errors';
import { Product } from '../domain/product';
import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from '../repositories/product.repository';

export interface CreateProductCommand {
  name: string;
  totalStock: number;
}

@Injectable()
export class ProductService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
  ) {}

  async create(command: CreateProductCommand): Promise<Product> {
    const product = Product.create({ id: randomUUID(), ...command });
    await this.products.save(product);
    return product;
  }

  async getById(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }
    return product;
  }

  list(): Promise<Product[]> {
    return this.products.findAll();
  }
}
