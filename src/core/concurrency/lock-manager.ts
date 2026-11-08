export const LOCK_MANAGER = Symbol('LOCK_MANAGER');

/**
 * Port for mutual exclusion keyed by resource. The in-process KeyedMutex is
 * enough for a single Node instance; running several instances would swap in
 * a distributed implementation (e.g. Redis/Redlock or DB advisory locks)
 * without touching the service.
 */
export interface LockManager {
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>;
}
