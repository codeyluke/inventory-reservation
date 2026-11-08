import { KeyedMutex } from './keyed-mutex';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('KeyedMutex', () => {
  let mutex: KeyedMutex;

  beforeEach(() => {
    mutex = new KeyedMutex();
  });

  it('returns the task result', async () => {
    await expect(
      mutex.runExclusive('k', () => Promise.resolve(42)),
    ).resolves.toBe(42);
  });

  it('runs tasks for the same key one at a time, in arrival order', async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const task = (name: string) => () =>
      mutex.runExclusive('product-1', async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        events.push(`start ${name}`);
        await tick();
        events.push(`end ${name}`);
        inFlight -= 1;
      });

    await Promise.all([task('a')(), task('b')(), task('c')()]);

    expect(maxInFlight).toBe(1);
    expect(events).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ]);
  });

  it('lets tasks for different keys run in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      ['product-1', 'product-2', 'product-3'].map((key) =>
        mutex.runExclusive(key, async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await tick();
          inFlight -= 1;
        }),
      ),
    );

    expect(maxInFlight).toBe(3);
  });

  it('releases the lock when a task throws', async () => {
    await expect(
      mutex.runExclusive('k', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(
      mutex.runExclusive('k', () => Promise.resolve('next')),
    ).resolves.toBe('next');
  });

  it('forgets keys once no task holds or waits for them (no memory leak)', async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        mutex.runExclusive(`key-${i % 10}`, async () => tick()),
      ),
    );

    expect(mutex.size).toBe(0);
  });
});
