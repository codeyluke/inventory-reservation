import {
  InsufficientStockError,
  ProductNotFoundError,
} from '../domain/product.errors';
import { InvalidArgumentError } from '../../core/errors/domain-error';
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

  describe('atomic stock updates', () => {
    const seed = (totalStock: number) =>
      repository.save(
        Product.create({ id: 'p-1', name: 'Sneaker', totalStock }),
      );
    const fireConcurrently = <T>(count: number, task: () => Promise<T>) =>
      Promise.allSettled(Array.from({ length: count }, task));
    const successes = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((r) => r.status === 'fulfilled').length;

    it('reserveStock checks availability and increments in one step', async () => {
      await seed(3);

      const updated = await repository.reserveStock('p-1', 2);

      expect(updated.reserved).toBe(2);
      expect((await repository.findById('p-1'))!.available).toBe(1);
    });

    it('reserveStock rejects without changing anything when stock is short', async () => {
      await seed(1);

      await expect(repository.reserveStock('p-1', 2)).rejects.toThrow(
        InsufficientStockError,
      );
      expect((await repository.findById('p-1'))!.reserved).toBe(0);
    });

    it('reserveStock rejects an unknown product', async () => {
      await expect(repository.reserveStock('missing', 1)).rejects.toThrow(
        ProductNotFoundError,
      );
    });

    it('commitStock and releaseStock settle reserved stock', async () => {
      await seed(5);
      await repository.reserveStock('p-1', 3);

      await repository.commitStock('p-1', 2);
      const updated = await repository.releaseStock('p-1', 1);

      expect(updated.toSnapshot()).toMatchObject({ sold: 2, reserved: 0 });
      await expect(repository.releaseStock('p-1', 1)).rejects.toThrow(
        InvalidArgumentError,
      );
    });

    it('500 simultaneous reserveStock calls on 1 unit: exactly 1 succeeds', async () => {
      await seed(1);

      const results = await fireConcurrently(500, () =>
        repository.reserveStock('p-1', 1),
      );

      expect(successes(results)).toBe(1);
      expect((await repository.findById('p-1'))!.reserved).toBe(1);
    });

    it('documents the race: a naive read-modify-write oversells under the same load', async () => {
      await seed(1);
      const naiveReserve = async () => {
        const product = (await repository.findById('p-1'))!;
        product.reserve(1); // every caller saw available = 1
        await repository.save(product);
      };

      const results = await fireConcurrently(500, naiveReserve);

      expect(successes(results)).toBe(500);
    });
  });
});
