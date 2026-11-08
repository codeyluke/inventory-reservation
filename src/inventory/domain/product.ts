import {
  InsufficientStockError,
  InvalidArgumentError,
  InvalidQuantityError,
} from './errors';

export interface ProductSnapshot {
  id: string;
  name: string;
  totalStock: number;
  sold: number;
  reserved: number;
}

const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

const assertPositiveQuantity = (quantity: number): void => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidQuantityError(quantity);
  }
};

/**
 * Aggregate that owns the stock counters for a single product.
 *
 *   available = totalStock - sold - reserved
 *
 * `sold` is the sum of confirmed reservations and `reserved` the sum of active
 * ones, so this is the business-rule formula from the brief kept as O(1)
 * counters. Every mutation re-checks the invariants, so the counters can never
 * drift into an oversold state, even if a caller misuses the API.
 */
export class Product {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly totalStock: number,
    private soldUnits: number,
    private reservedUnits: number,
  ) {
    Product.assertValid({
      id,
      name,
      totalStock,
      sold: soldUnits,
      reserved: reservedUnits,
    });
  }

  static create(props: { id: string; name: string; totalStock: number }) {
    return new Product(props.id, props.name.trim(), props.totalStock, 0, 0);
  }

  static fromSnapshot(snapshot: ProductSnapshot): Product {
    return new Product(
      snapshot.id,
      snapshot.name,
      snapshot.totalStock,
      snapshot.sold,
      snapshot.reserved,
    );
  }

  get sold(): number {
    return this.soldUnits;
  }

  get reserved(): number {
    return this.reservedUnits;
  }

  get available(): number {
    return this.totalStock - this.soldUnits - this.reservedUnits;
  }

  /** Holds stock for a pending reservation. */
  reserve(quantity: number): void {
    assertPositiveQuantity(quantity);
    if (quantity > this.available) {
      throw new InsufficientStockError(this.id, quantity, this.available);
    }
    this.reservedUnits += quantity;
  }

  /** Returns held stock to the pool (reservation cancelled or expired). */
  release(quantity: number): void {
    assertPositiveQuantity(quantity);
    this.assertReservedAtLeast(quantity);
    this.reservedUnits -= quantity;
  }

  /** Turns held stock into a completed sale (reservation confirmed). */
  commit(quantity: number): void {
    assertPositiveQuantity(quantity);
    this.assertReservedAtLeast(quantity);
    this.reservedUnits -= quantity;
    this.soldUnits += quantity;
  }

  toSnapshot(): ProductSnapshot {
    return {
      id: this.id,
      name: this.name,
      totalStock: this.totalStock,
      sold: this.soldUnits,
      reserved: this.reservedUnits,
    };
  }

  private assertReservedAtLeast(quantity: number): void {
    if (quantity > this.reservedUnits) {
      throw new InvalidArgumentError(
        `Product ${this.id} has only ${this.reservedUnits} unit(s) reserved, cannot settle ${quantity}.`,
      );
    }
  }

  private static assertValid(snapshot: ProductSnapshot): void {
    if (!snapshot.id) {
      throw new InvalidArgumentError('Product id is required.');
    }
    if (!snapshot.name.trim()) {
      throw new InvalidArgumentError('Product name is required.');
    }
    if (!isNonNegativeInteger(snapshot.totalStock)) {
      throw new InvalidArgumentError(
        'Total stock must be a non-negative integer.',
      );
    }
    if (
      !isNonNegativeInteger(snapshot.sold) ||
      !isNonNegativeInteger(snapshot.reserved) ||
      snapshot.sold + snapshot.reserved > snapshot.totalStock
    ) {
      throw new InvalidArgumentError(
        `Product ${snapshot.id} stock counters are inconsistent.`,
      );
    }
  }
}
