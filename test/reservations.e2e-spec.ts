import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Agent } from 'node:http';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CLOCK } from '../src/common/clock/clock';
import { FakeClock } from '../src/testing/fake-clock';

const HOLD_MS = 120_000;

interface ProductBody {
  id: string;
  name: string;
  totalStock: number;
  sold: number;
  reserved: number;
  available: number;
}

interface ReservationBody {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  status: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
}

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
}

describe('Inventory reservation API (e2e)', () => {
  let app: INestApplication<App>;
  let clock: FakeClock;

  const http = () => request(app.getHttpServer());

  const createProduct = async (totalStock: number): Promise<ProductBody> => {
    const res = await http()
      .post('/products')
      .send({ name: 'Flash Sale Sneaker', totalStock })
      .expect(201);
    return res.body as ProductBody;
  };

  const getProduct = async (id: string): Promise<ProductBody> =>
    (await http().get(`/products/${id}`).expect(200)).body as ProductBody;

  /** Each call is a distinct purchase attempt, so it gets its own key. */
  const reserve = (productId: string, userId = 'alice', quantity?: number) =>
    http()
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({ productId, userId, quantity });

  beforeAll(async () => {
    process.env.EXPIRY_SWEEP_INTERVAL_MS = '20';
    clock = new FakeClock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0); // real socket, so concurrent requests are real
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EXPIRY_SWEEP_INTERVAL_MS;
  });

  describe('products', () => {
    it('creates and reads a product', async () => {
      const product = await createProduct(5);

      expect(product).toEqual({
        id: expect.any(String) as string,
        name: 'Flash Sale Sneaker',
        totalStock: 5,
        sold: 0,
        reserved: 0,
        available: 5,
      });
      await expect(getProduct(product.id)).resolves.toEqual(product);
    });

    it('lists products', async () => {
      const product = await createProduct(1);

      const res = await http().get('/products').expect(200);

      expect((res.body as ProductBody[]).map((p) => p.id)).toContain(
        product.id,
      );
    });

    it.each([
      [{ name: '', totalStock: 1 }],
      [{ name: 'x', totalStock: -1 }],
      [{ name: 'x', totalStock: 1.5 }],
      [{ name: 'x' }],
      [{ name: 'x', totalStock: 1, extra: true }],
    ])('rejects an invalid body %j with 400', async (body) => {
      const res = await http().post('/products').send(body).expect(400);

      expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
    });

    it('returns 404 for an unknown product', async () => {
      const res = await http().get(`/products/${randomUUID()}`).expect(404);

      expect((res.body as ErrorBody).code).toBe('PRODUCT_NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      await http().get('/products/not-a-uuid').expect(400);
    });
  });

  describe('reservation lifecycle', () => {
    it('Level 1: stock = 1, user A succeeds and user B gets 409', async () => {
      const product = await createProduct(1);

      const a = await reserve(product.id, 'A').expect(201);
      const b = await reserve(product.id, 'B').expect(409);

      expect((a.body as ReservationBody).status).toBe('ACTIVE');
      expect((b.body as ErrorBody).code).toBe('INSUFFICIENT_STOCK');
    });

    it('holds stock for 2 minutes', async () => {
      const product = await createProduct(3);

      const res = await reserve(product.id, 'alice', 2).expect(201);
      const body = res.body as ReservationBody;

      expect(
        new Date(body.expiresAt).getTime() - new Date(body.createdAt).getTime(),
      ).toBe(HOLD_MS);
      expect((await getProduct(product.id)).available).toBe(1);
    });

    it('confirm completes the purchase; it cannot then be cancelled', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;

      const confirmed = await http()
        .post(`/reservations/${id}/confirm`)
        .expect(200);
      const cancel = await http()
        .post(`/reservations/${id}/cancel`)
        .expect(409);

      expect((confirmed.body as ReservationBody).status).toBe('CONFIRMED');
      expect((cancel.body as ErrorBody).code).toBe('INVALID_RESERVATION_STATE');
      expect(await getProduct(product.id)).toMatchObject({
        sold: 1,
        available: 0,
      });
    });

    it('cancel releases stock for the next buyer', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;

      await http().post(`/reservations/${id}/cancel`).expect(200);

      await reserve(product.id, 'bob').expect(201);
    });

    it('confirming after the hold window returns 409 RESERVATION_EXPIRED', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;
      clock.advanceBy(HOLD_MS);

      const res = await http().post(`/reservations/${id}/confirm`).expect(409);

      expect((res.body as ErrorBody).code).toBe('RESERVATION_EXPIRED');
      expect((await getProduct(product.id)).available).toBe(1);
    });

    it('the background sweeper releases expired stock automatically', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;
      clock.advanceBy(HOLD_MS);

      await waitFor(async () => (await getProduct(product.id)).available === 1);

      const res = await http().get(`/reservations/${id}`).expect(200);
      expect((res.body as ReservationBody).status).toBe('EXPIRED');
    });

    it.each([
      [{ userId: 'a' }],
      [{ productId: 'not-a-uuid', userId: 'a' }],
      [{ productId: randomUUID(), userId: '' }],
      [{ productId: randomUUID(), userId: 'a', quantity: 0 }],
    ])('rejects an invalid reservation body %j with 400', async (body) => {
      const res = await http()
        .post('/reservations')
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);

      expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
    });

    it('returns 404 when reserving an unknown product', async () => {
      const res = await reserve(randomUUID()).expect(404);

      expect((res.body as ErrorBody).code).toBe('PRODUCT_NOT_FOUND');
    });

    it('returns 404 for an unknown reservation', async () => {
      await http().post(`/reservations/${randomUUID()}/confirm`).expect(404);
    });
  });

  describe('idempotency', () => {
    const reserveWithKey = (
      productId: string,
      key: string,
      body: Record<string, unknown> = {},
    ) =>
      http()
        .post('/reservations')
        .set('Idempotency-Key', key)
        .send({ productId, userId: 'alice', ...body });

    it('confirm is idempotent: a retry returns 200 with the same result', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;

      const first = await http()
        .post(`/reservations/${id}/confirm`)
        .expect(200);
      const retry = await http()
        .post(`/reservations/${id}/confirm`)
        .expect(200);

      expect(retry.body).toEqual(first.body);
      expect((await getProduct(product.id)).sold).toBe(1);
    });

    it('cancel is idempotent: a retry returns 200', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;

      await http().post(`/reservations/${id}/cancel`).expect(200);
      const retry = await http().post(`/reservations/${id}/cancel`).expect(200);

      expect((retry.body as ReservationBody).status).toBe('CANCELLED');
      expect((await getProduct(product.id)).available).toBe(1);
    });

    it('confirming a cancelled reservation is still a 409 conflict', async () => {
      const product = await createProduct(1);
      const { id } = (await reserve(product.id).expect(201))
        .body as ReservationBody;
      await http().post(`/reservations/${id}/cancel`).expect(200);

      const res = await http().post(`/reservations/${id}/confirm`).expect(409);

      expect((res.body as ErrorBody).code).toBe('INVALID_RESERVATION_STATE');
    });

    it('a repeated reserve with the same Idempotency-Key returns the original', async () => {
      const product = await createProduct(5);
      const key = randomUUID();

      const first = await reserveWithKey(product.id, key).expect(201);
      const retry = await reserveWithKey(product.id, key).expect(201);

      expect(retry.body).toEqual(first.body);
      expect((await getProduct(product.id)).reserved).toBe(1);
    });

    it('double-click: 20 simultaneous requests with one key hold stock once', async () => {
      const product = await createProduct(5);
      const key = randomUUID();

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => reserveWithKey(product.id, key)),
      );

      expect(responses.every((res) => res.status === 201)).toBe(true);
      const ids = new Set(
        responses.map((res) => (res.body as ReservationBody).id),
      );
      expect(ids.size).toBe(1);
      expect((await getProduct(product.id)).reserved).toBe(1);
    });

    it('reusing a key with a different body returns 422', async () => {
      const product = await createProduct(5);
      const key = randomUUID();
      await reserveWithKey(product.id, key).expect(201);

      const res = await reserveWithKey(product.id, key, { quantity: 2 }).expect(
        422,
      );

      expect((res.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    });

    it('rejects a reservation without an Idempotency-Key header', async () => {
      const product = await createProduct(1);

      const res = await http()
        .post('/reservations')
        .send({ productId: product.id, userId: 'alice' })
        .expect(400);

      expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
      expect((await getProduct(product.id)).reserved).toBe(0);
    });

    it.each([['   '], ['x'.repeat(256)]])(
      'rejects an invalid Idempotency-Key header %#',
      async (key) => {
        const product = await createProduct(1);

        const res = await reserveWithKey(product.id, key).expect(400);

        expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('Level 3: concurrency over real HTTP', () => {
    // All 500 requests are fired at once and are in flight together. They are
    // multiplexed over a pool of keep-alive sockets because opening 500 TCP
    // connections in the same instant overflows the OS accept backlog (128 on
    // macOS) and the kernel resets connections before they reach the app.
    const agent = new Agent({ keepAlive: true, maxSockets: 50 });

    afterAll(() => agent.destroy());

    it('stock = 1, 500 simultaneous requests: 1 x 201, 499 x 409', async () => {
      const product = await createProduct(1);

      const responses = await Promise.all(
        Array.from({ length: 500 }, (_, i) =>
          reserve(product.id, `user-${i}`).agent(agent),
        ),
      );

      const statuses = responses.map((res) => res.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(499);
      expect(await getProduct(product.id)).toMatchObject({
        reserved: 1,
        available: 0,
      });
    });
  });
});

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
