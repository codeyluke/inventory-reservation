import { Product } from '../domain/product';

export interface ProductResponse {
  id: string;
  name: string;
  totalStock: number;
  sold: number;
  reserved: number;
  available: number;
}

export const toProductResponse = (product: Product): ProductResponse => ({
  id: product.id,
  name: product.name,
  totalStock: product.totalStock,
  sold: product.sold,
  reserved: product.reserved,
  available: product.available,
});
