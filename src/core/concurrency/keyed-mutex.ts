import { LockManager } from './lock-manager';

/**
 * An async mutex per key, built on promise chaining.
 *
 * Node runs JavaScript on one thread, but any `await` inside a critical section
 * lets other requests interleave. Holding a per-key lock across the whole
 * read-check-write sequence prevents that, while different keys (products)
 * still proceed in parallel. Waiters are served FIFO, and a key is removed
 * from the map as soon as nobody holds or waits for it.
 */
export class KeyedMutex implements LockManager {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  /** Number of keys currently locked or contended (for diagnostics/tests). */
  get size(): number {
    return this.tails.size;
  }
}
