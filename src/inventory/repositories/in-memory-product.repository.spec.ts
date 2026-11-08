import { Product } from '../domain/product';
import { InMemoryProductRepository } from './in-memory-product.repository';

describe('InMemoryProductRepository', () => {
  let repository: InMemoryProductRepository;

  beforeEach(() => {
    repository = new InMemoryProductRepository();
  });

  it('returns null for an unknown product', async () => {
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('persists and loads a product', async () => {
    await repository.save(
      Product.create({ id: 'p-1', name: 'Sneaker', totalStock: 3 }),
    );

    const loaded = await repository.findById('p-1');

    expect(loaded?.toSnapshot()).toEqual({
      id: 'p-1',
      name: 'Sneaker',
      totalStock: 3,
      sold: 0,
      reserved: 0,
    });
  });

  it('behaves like a real store: mutations are invisible until saved', async () => {
    await repository.save(
      Product.create({ id: 'p-1', name: 'Sneaker', totalStock: 3 }),
    );

    const loaded = await repository.findById('p-1');
    loaded!.reserve(1);

    expect((await repository.findById('p-1'))!.reserved).toBe(0);

    await repository.save(loaded!);
    expect((await repository.findById('p-1'))!.reserved).toBe(1);
  });

  it('lists all products', async () => {
    await repository.save(
      Product.create({ id: 'a', name: 'A', totalStock: 1 }),
    );
    await repository.save(
      Product.create({ id: 'b', name: 'B', totalStock: 2 }),
    );

    const ids = (await repository.findAll()).map((p) => p.id);

    expect(ids).toEqual(['a', 'b']);
  });
});
