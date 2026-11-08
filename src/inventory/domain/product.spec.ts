import {
  InsufficientStockError,
  InvalidArgumentError,
  InvalidQuantityError,
} from './errors';
import { Product } from './product';

describe('Product', () => {
  const create = (totalStock = 10) =>
    Product.create({ id: 'p-1', name: 'Limited Sneaker', totalStock });

  describe('create', () => {
    it('starts with all stock available', () => {
      const product = create(5);

      expect(product.totalStock).toBe(5);
      expect(product.sold).toBe(0);
      expect(product.reserved).toBe(0);
      expect(product.available).toBe(5);
    });

    it.each([-1, 1.5, Number.NaN])(
      'rejects an invalid total stock of %p',
      (totalStock) => {
        expect(() => create(totalStock)).toThrow(InvalidArgumentError);
      },
    );

    it('rejects a blank name', () => {
      expect(() =>
        Product.create({ id: 'p-1', name: '  ', totalStock: 1 }),
      ).toThrow(InvalidArgumentError);
    });
  });

  describe('reserve', () => {
    it('moves stock from available to reserved', () => {
      const product = create(10);

      product.reserve(3);

      expect(product.reserved).toBe(3);
      expect(product.available).toBe(7);
    });

    it('allows reserving exactly the remaining stock', () => {
      const product = create(1);

      product.reserve(1);

      expect(product.available).toBe(0);
    });

    it('fails when the request exceeds available stock', () => {
      const product = create(1);
      product.reserve(1);

      expect(() => product.reserve(1)).toThrow(InsufficientStockError);
      expect(product.reserved).toBe(1);
    });

    it.each([0, -1, 1.5])('rejects a quantity of %p', (quantity) => {
      expect(() => create().reserve(quantity)).toThrow(InvalidQuantityError);
    });
  });

  describe('release', () => {
    it('returns reserved stock to available', () => {
      const product = create(10);
      product.reserve(4);

      product.release(4);

      expect(product.reserved).toBe(0);
      expect(product.available).toBe(10);
    });

    it('refuses to release more than is reserved', () => {
      const product = create(10);
      product.reserve(1);

      expect(() => product.release(2)).toThrow(InvalidArgumentError);
    });
  });

  describe('commit', () => {
    it('converts reserved stock into sold stock', () => {
      const product = create(10);
      product.reserve(2);

      product.commit(2);

      expect(product.reserved).toBe(0);
      expect(product.sold).toBe(2);
      expect(product.available).toBe(8);
    });

    it('refuses to commit stock that was never reserved', () => {
      expect(() => create().commit(1)).toThrow(InvalidArgumentError);
    });
  });

  describe('snapshots', () => {
    it('round-trips through a snapshot without sharing state', () => {
      const original = create(10);
      original.reserve(2);

      const copy = Product.fromSnapshot(original.toSnapshot());
      copy.reserve(1);

      expect(copy.reserved).toBe(3);
      expect(original.reserved).toBe(2);
    });

    it('rejects a snapshot that violates stock invariants', () => {
      expect(() =>
        Product.fromSnapshot({
          id: 'p-1',
          name: 'x',
          totalStock: 1,
          sold: 1,
          reserved: 1,
        }),
      ).toThrow(InvalidArgumentError);
    });
  });
});
