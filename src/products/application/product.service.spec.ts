import { ProductNotFoundError } from '../domain/product.errors';
import { InMemoryProductRepository } from '../repositories/in-memory-product.repository';
import { ProductService } from './product.service';

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(() => {
    service = new ProductService(new InMemoryProductRepository());
  });

  it('creates a product with a generated id and full availability', async () => {
    const product = await service.create({ name: 'Console', totalStock: 5 });

    expect(product.id).toEqual(expect.any(String));
    expect(product.available).toBe(5);
    await expect(service.getById(product.id)).resolves.toMatchObject({
      name: 'Console',
      totalStock: 5,
    });
  });

  it('throws when the product does not exist', async () => {
    await expect(service.getById('missing')).rejects.toThrow(
      ProductNotFoundError,
    );
  });

  it('lists products', async () => {
    await service.create({ name: 'A', totalStock: 1 });
    await service.create({ name: 'B', totalStock: 1 });

    await expect(service.list()).resolves.toHaveLength(2);
  });
});
