# Inventory Reservation System

A NestJS + TypeScript API that lets users temporarily reserve limited stock
during a flash sale **without ever overselling**, even when hundreds of
requests for the last item arrive at the same moment.

```
stock = 1, 500 simultaneous requests  →  1 × 201 Created, 499 × 409 Conflict
```

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run start:dev          # http://localhost:3000
npm run test:all           # typecheck + lint + unit + e2e
```

Configuration (all optional, see `.env.example`):

| Variable                   | Default | Meaning                                 |
| -------------------------- | ------- | --------------------------------------- |
| `PORT`                     | `3000`  | HTTP port                               |
| `RESERVATION_HOLD_SECONDS` | `120`   | How long a reservation holds stock      |
| `EXPIRY_SWEEP_INTERVAL_MS` | `1000`  | How often lapsed reservations are swept |

Invalid values fail fast at startup.

## API

| Method | Path                        | Success | Errors                                                                                                                                       |
| ------ | --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/products`                 | 201     | 400 `VALIDATION_FAILED`                                                                                                                      |
| GET    | `/products`                 | 200     |                                                                                                                                              |
| GET    | `/products/:id`             | 200     | 404 `PRODUCT_NOT_FOUND`                                                                                                                      |
| POST   | `/reservations`             | 201     | 400 `VALIDATION_FAILED` (incl. missing `Idempotency-Key`), 404 `PRODUCT_NOT_FOUND`, 409 `INSUFFICIENT_STOCK`, 422 `IDEMPOTENCY_KEY_MISMATCH` |
| GET    | `/reservations/:id`         | 200     | 404 `RESERVATION_NOT_FOUND`                                                                                                                  |
| POST   | `/reservations/:id/confirm` | 200     | 409 `RESERVATION_EXPIRED`, 409 `INVALID_RESERVATION_STATE`                                                                                   |
| POST   | `/reservations/:id/cancel`  | 200     | 409 `RESERVATION_EXPIRED`, 409 `INVALID_RESERVATION_STATE`                                                                                   |

Errors share one shape: `{ "statusCode": 409, "code": "INSUFFICIENT_STOCK", "message": "..." }`.
Clients should branch on `code`, not on the message.

`POST /reservations` **requires an `Idempotency-Key` header**: a unique value (for example, a UUID)
per purchase attempt. Confirm and cancel are idempotent: repeating them returns `200` with the
same result. See [Idempotency](#idempotency-double-requests).

**Postman:** import `postman/inventory-reservation.postman_collection.json`. Run the folders in
order; each request saves the ids it creates for the next one. To try expiry without waiting
2 minutes, start the server with `RESERVATION_HOLD_SECONDS=20 npm run start:dev`.

```bash
# Create a product with one unit
curl -s -XPOST localhost:3000/products -H 'content-type: application/json' \
  -d '{"name":"Limited Sneaker","totalStock":1}'

# Reserve it (quantity defaults to 1). The Idempotency-Key makes retries safe.
curl -s -XPOST localhost:3000/reservations -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"productId":"<product-id>","userId":"alice"}'

# Confirm within 2 minutes, or cancel
curl -s -XPOST localhost:3000/reservations/<reservation-id>/confirm
```

## How the brief maps to the code

| Brief                                                          | Where                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Available = Total − Confirmed − Active                         | `Product.available` (`totalStock - sold - reserved`)                             |
| Reservations exceeding available stock fail                    | `Product.reserve` → `InsufficientStockError` → 409                               |
| Confirmed purchases cannot be reversed                         | `Reservation` state machine: `CONFIRMED` is terminal                             |
| Only one user can reserve the last item                        | Atomic `reserveStock` + per-product lock (see below)                             |
| Expired reservations release stock                             | Entity deadline + lazy reclaim + background sweeper                              |
| **Level 1**: in-memory inventory, reserve                      | `InMemory*Repository`, `ReservationService.reserve`                              |
| **Level 2**: Active/Confirmed/Cancelled/Expired, 2-minute hold | `Reservation`, `ReservationService.confirm/cancel`, `ReservationExpiryScheduler` |
| **Level 3**: no race conditions, 500 → 1                       | `KeyedMutex`, atomic stock operations, `reservation.concurrency.spec.ts`         |

## Architecture

```
src/
├── common/
│   ├── clock/          Clock port + SystemClock (time is injectable)
│   ├── concurrency/    LockManager port + KeyedMutex
│   └── http/           Validation pipe, domain-error → HTTP filter
├── inventory/
│   ├── domain/         Product, Reservation, domain errors (no framework code)
│   ├── application/    ReservationService, ProductService, expiry scheduler
│   ├── repositories/   Repository ports + in-memory adapters
│   ├── http/           Controllers, DTOs, response presenters
│   └── inventory.module.ts   Wires ports to adapters
└── testing/            FakeClock, NoOpLockManager (excluded from build)
```

- **The domain layer enforces the rules.** `Product` guards its stock counters and `Reservation`
  guards its state transitions and deadline. Both throw domain errors, so the rules hold no matter
  which caller uses them.
- **Ports and adapters (dependency inversion).** Services depend on `ProductRepository`,
  `ReservationRepository`, `LockManager` and `Clock` interfaces. Moving to MySQL or Redis means
  changing a provider in `InventoryModule`, not the services.
- **The HTTP layer only translates.** Controllers map DTOs to commands and domain objects to
  responses. `DomainExceptionFilter` maps each error `code` to a status.

### Reservation lifecycle

```
ACTIVE ──confirm──▶ CONFIRMED  (terminal: a sale cannot be reversed)
  ├─────cancel───▶ CANCELLED  (stock released)
  └─────expire───▶ EXPIRED    (stock released; hold window elapsed)
```

The service keeps this invariant for every product:
`reserved = Σ quantity of ACTIVE reservations` and `sold = Σ quantity of CONFIRMED reservations`.

## Locking strategy (Level 3)

### The problem

Node runs JavaScript on one thread, so it's tempting to say "there are no races". That's only true
for code with no `await` in it. Any `await` between reading stock and writing it lets other requests
run in between. I proved this before fixing it: the Level 2 code let **500 out of 500** concurrent
reservations succeed for a single unit (see commit `feat(level-3)`). Real storage (a database or
Redis) is always async, so the repository contract is async on purpose and the concurrency design
can't rely on the event loop by accident.

### The solution: two layers, each covering a different risk

**1. Atomic stock updates: prevent overselling.**
Stock never changes through a read, modify, then save sequence. `ProductRepository` exposes
`reserveStock`, `commitStock` and `releaseStock`. Each one checks the invariant and writes the
change in a single indivisible step. In memory, that means the read, validation and write all run
synchronously with no `await`, and Node never interleaves other code inside a synchronous block.
With a database it would be one conditional statement:

```sql
UPDATE products SET reserved = reserved + :qty
WHERE id = :id AND total_stock - sold - reserved >= :qty;   -- 0 rows affected → sold out
```

On its own, this layer guarantees "1 success out of 500".

**2. A lock per product: keep multi-step changes consistent.**
A use case such as confirm touches two records across several `await`s: the reservation's status
and the product's counters. Atomic counter updates can't stop two requests from both reading a
reservation as `ACTIVE` and then one confirming it while the other cancels it. Each of those counter
changes is valid on its own; only together do they corrupt the stock. `ReservationService` therefore
runs every use case (reserve, confirm, cancel, expire) inside `LockManager.runExclusive("product:<id>")`
and re-reads the reservation once it holds the lock.

- **Lock per product, not global.** Contention on one hot item never slows down the others.
- **`KeyedMutex`** is a small async mutex built from chained promises. Waiters are served in arrival
  order, the lock is released even if the task throws, and a key is removed once nobody holds or
  waits for it, so memory doesn't leak. It's **not re-entrant**: helpers that run inside a locked
  section never try to take the lock again.

### Proving each layer is needed

`reservation.concurrency.spec.ts` and `in-memory-product.repository.spec.ts` include control tests:

- A naive read-modify-write under 500 concurrent calls **oversells** (500/500 succeed).
- With the lock replaced by `NoOpLockManager`, confirm and cancel on the same reservation **both
  succeed**, and the stock counters no longer match the reservations.

The main tests then show the real implementation holding up under load:

- Stock 1 with 500 requests gives 1 success and 499 `InsufficientStockError`.
- Stock 10 gives exactly 10 successes.
- Mixed quantities never oversell.
- 500 simultaneous confirms of one reservation all return CONFIRMED, and it's sold once.
- 100 simultaneous reserves with one `Idempotency-Key` create one reservation and hold stock once.
- Confirm racing cancel, and confirm racing the sweeper, each settle the stock exactly once.
- After an expiry, 500 users racing for the released unit gives 1 winner.
- Contention on one product doesn't affect another.

The e2e suite repeats the 500-request test over real HTTP.

### Scaling beyond one process

The in-process mutex only covers a single Node instance. With several instances behind a load
balancer, both layers move into shared infrastructure through the same ports:

- **Atomic stock update:** a conditional `UPDATE` (as above), or a Redis Lua script /
  `DECRBY` with a check.
- **Lock:** a database transaction with `SELECT … FOR UPDATE` on the product row, or a distributed
  lock (Redis/Redlock) with a TTL, implementing `LockManager`.

## Idempotency (double requests)

Clients retry. Users double-click "Buy". Payment providers deliver "payment succeeded" webhooks
at least once, so the same confirmation can arrive twice. Every write is therefore safe to repeat.

**Confirm and cancel are idempotent by state.** Repeating a transition that already happened is a
no-op that returns `200` with the current reservation. `Reservation.confirm/cancel` return `false`,
and the service then skips the stock update, so a sale is counted and stock is released exactly
once. Contradictory requests still fail with `409 INVALID_RESERVATION_STATE`: confirming a
cancelled reservation, or cancelling a confirmed purchase.

**Reserve requires an `Idempotency-Key` and is idempotent per key.** The client sends a unique key
per purchase attempt (for example, a UUID generated when "Buy" is clicked). The header is
required rather than optional because a client that forgot it would silently lose duplicate
protection. Rejecting the request makes the mistake visible straight away:

| Request                                         | Result                                             |
| ----------------------------------------------- | -------------------------------------------------- |
| First request with a key                        | `201`, new reservation, stock held                 |
| Same user, same key, same body                  | `201`, **the original reservation**, no extra hold |
| Same user, same key, different product/quantity | `422 IDEMPOTENCY_KEY_MISMATCH`                     |
| Different user, same key                        | Independent (keys are scoped per user)             |
| Same user, new key                              | A separate purchase: new reservation               |
| Missing or malformed header                     | `400 VALIDATION_FAILED`, no stock touched          |

- **The key and the lock do different jobs.** The key stops the _same_ client's repeats from
  becoming extra purchases. When 500 _different_ users race for the last unit, each has its own
  key, and the per-product lock plus the atomic stock update decide the single winner.
- **Duplicates that arrive at the same instant.** The key lookup and the reservation it creates run
  under a lock on `(userId, key)`, so even simultaneous duplicates produce exactly one reservation.
  Locks are always taken in the order key → product, never the reverse, so they can't deadlock.
- **A failed attempt doesn't use up the key.** Only a created reservation is stored against it, so
  retrying after `409 INSUFFICIENT_STOCK` can still succeed later.
- **A replay returns the reservation's current state.** If it has since been confirmed or expired,
  the client sees that rather than a stale `ACTIVE`.

### Confirming without a payment integration

The brief has no payment step, so `POST /reservations/:id/confirm` stands in for "payment
succeeded". In production, the checkout or payment service would call it after the provider
reports success, and call cancel (or let the hold expire) when payment fails or is abandoned:

```
reserve (2-min hold) → user pays → payment succeeded → confirm   (safe to repeat)
                                 → failed/abandoned  → cancel or expire
```

## Expiry strategy

The hold is enforced in three places, so expiry is exact without depending on timers:

1. **The entity itself.** Once `now >= expiresAt`, an `ACTIVE` reservation can no longer be
   confirmed or cancelled, even if nothing has marked it `EXPIRED` yet. Confirm and cancel expire it
   on the spot (releasing the stock) and return `409 RESERVATION_EXPIRED`.
2. **Lazy reclaim on reserve.** If a new reservation can't be satisfied, lapsed holds on that
   product are expired first and the request is retried once. A sold-out product becomes available
   again the moment a hold lapses, not up to one sweep later.
3. **Background sweeper** (`ReservationExpiryScheduler`, every second by default). It returns stock
   from abandoned holds even when nobody touches that product. Sweeps never overlap, a failed sweep
   doesn't stop later ones, the timer doesn't keep the process alive, and it stops cleanly on shutdown.

Time comes from an injected `Clock`, so the 2-minute rules are tested deterministically with
`FakeClock` instead of sleeping. A reservation expires **at** `expiresAt`
(confirming 1 ms before the deadline succeeds; confirming at the deadline fails).

## Testing

```bash
npm test          # unit + service-level concurrency tests (115)
npm run test:e2e  # HTTP end-to-end incl. 500 concurrent requests and idempotency (31)
npm run test:cov  # coverage
```

The code was built test-first, level by level. The git history shows the order: Level 1, then
Level 2, then the race probe and the Level 3 fix, then the API.

## Assumptions

- **Storage is in memory**, as the brief specifies, so data is lost on restart.
- **A reservation can be for any positive quantity** (default 1). The rule "reservations exceeding
  available stock must fail" implies quantities above 1 are allowed.
- **`userId` is sent in the request body** as a stand-in for authentication. In production it would
  come from the authenticated identity.
- **One user may hold several reservations.** The brief sets no per-user limit (see improvements).
- **Cancelling or confirming an expired reservation returns `409 RESERVATION_EXPIRED`** rather than
  quietly succeeding, so the client always knows the hold is gone.
- **Products are created through the API** with a fixed `totalStock`. Restocking wasn't in scope.

## Trade-offs

- **Stock is kept as counters on the product, not recalculated.** `sold` and `reserved` give O(1)
  availability checks, which matters on the hot path. The cost is keeping them in sync with the
  reservations. The lock and the invariant tests are what guarantee they stay in sync.
- **Confirm/cancel reads the reservation once before taking the lock.** It needs the `productId` to
  know which lock to take. That's safe because `productId` never changes, and the reservation is
  read again once the lock is held.
- **Saving a reservation and updating stock are not one transaction in memory.** `reserve` undoes
  the stock hold if saving the reservation fails. With a database, each use case would run in one
  transaction.
- **409 is used for every state conflict, with a distinct `code` for each,** rather than also
  using 410 for expiry. Clients get one status per category and a precise code. The exception is
  `422` for a reused idempotency key, which is a client bug, not a state the user can resolve.
- **A replayed reserve returns `201` with the original body** (same request, same response), without
  an `Idempotent-Replayed` header. Idempotency keys live as long as their reservation. With
  persistent storage they would expire after a retention window (for example, 24 hours).

## What I'd improve with more time

- A MySQL/Postgres adapter (conditional `UPDATE` plus transactions) and a Redis-backed `LockManager`
  for running several instances, run against the same repository contract tests.
- A per-user limit (for example, one active hold per user per product) and rate limiting against bots.
- Authentication so `userId` comes from a token, and only the owner can confirm or cancel.
- OpenAPI/Swagger docs, structured logging, metrics (holds, expiries, lock wait time) and a health check.
- A load test (k6/autocannon) against a running instance, plus a Dockerfile and CI.
