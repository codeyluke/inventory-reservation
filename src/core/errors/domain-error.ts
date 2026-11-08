/**
 * Base class for business-rule violations. Each error carries a stable,
 * machine-readable `code` so the HTTP layer can map it to a status without
 * the domain knowing anything about HTTP.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidArgumentError extends DomainError {
  readonly code = 'INVALID_ARGUMENT';
}

export class InvalidQuantityError extends DomainError {
  readonly code = 'INVALID_QUANTITY';

  constructor(quantity: number) {
    super(`Quantity must be a positive integer, received ${quantity}.`);
  }
}
