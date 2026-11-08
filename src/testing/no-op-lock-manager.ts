import { LockManager } from '../core/concurrency/lock-manager';

/** A lock that does nothing: used to prove the real lock is load-bearing. */
export class NoOpLockManager implements LockManager {
  runExclusive<T>(_key: string, task: () => Promise<T>): Promise<T> {
    return task();
  }
}
