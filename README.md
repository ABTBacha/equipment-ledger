# The Equipment Ledger

A site-store equipment ledger: issue and return tools to workers, reserve them ahead of time, and answer "who held what at any past instant" — provably correct under real concurrency, not just in the happy path.

The store keeper's problem is small to describe and easy to get wrong: an asset must never be held by two people at once, a correction must not erase what actually happened, and the answer to "who had the angle grinder last Tuesday at 14:00?" has to come out of the ledger itself rather than out of someone's memory. This project takes those three constraints seriously and shows the mechanics that enforce them.

**Stack:** Next.js (App Router) · NestJS · MongoDB · TypeScript, in an npm workspaces monorepo.

---

## What it does

- **Issue and return** assets to workers, with the "one holder, ever" rule enforced by the database itself rather than by application-level checking.
- **Certification gating** — an asset can require a certification, and issuing to a worker whose certification is missing or expired is refused. Certifications can be added, renewed, and removed per worker.
- **Reservations** — book an asset for a future window. Overlapping windows on the same asset are impossible, including under simultaneous requests. Reservations are cancelled, never deleted, so a called-off booking is still part of the record.
- **Out of service** — take an asset out of circulation (with a reason) and bring it back; both are ledger movements like any other.
- **Corrections** — fix a wrongly logged time or detail by appending a correction that references the original. The original is never mutated.
- **Time travel** — reconstruct the entire store's state as of any past instant by replaying the ledger.
- **An invariant checker** that independently replays the ledger and proves the live state agrees with it.

### Screens

| Route | What it's for |
| --- | --- |
| `/` | Dashboard — every asset, its status, holder, upcoming reservation and last activity, with issue/return/out-of-service actions |
| `/assets/:id` | One asset: current state, required certification, its reservations, and its full movement history |
| `/workers` | All workers, paginated |
| `/workers/:id` | One worker: certifications (editable), what they're holding, their reservations |
| `/reservations` | Book a window, and cancel an existing booking |
| `/history` | Scrub to any past instant and see the store as it was then |

---

## Quick start

**Prerequisites:** Node.js 18.17 or newer (the floor Next.js 14 requires), and MongoDB running **as a replica set** — the concurrency guarantees below use transactions, which single-node standalone MongoDB does not support.

### 1. Start MongoDB

<details open>
<summary><strong>With Docker (recommended)</strong></summary>

```bash
docker compose up -d
```

This starts `mongo:7` with `--replSet rs0` and runs `scripts/mongo-init.sh` to initiate the replica set for you.

One caveat: the set registers its member under the container hostname (`mongo:27017`), which your host machine can't resolve, so replica-set *discovery* from the host will fail. Connect directly instead — the driver still gets transactions this way, because the node it connects to is a replica-set member:

```bash
MONGO_URI="mongodb://localhost:27017/equipment_ledger?directConnection=true"
```
</details>

<details>
<summary><strong>With a locally installed MongoDB</strong></summary>

Add a replication key to your `mongod.cfg` (editing it typically needs administrator privileges), then restart the service:

```yaml
replication:
  replSetName: "rs0"
```

Then initiate the set once — via `mongosh`:

```bash
mongosh --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]})'
```

`mongosh` ships separately from the server as of MongoDB 6. If you don't have it, the same call works through the Node driver:

```js
// node init-rs.js
const { MongoClient } = require('mongodb');
const client = new MongoClient('mongodb://localhost:27017/?directConnection=true');
client.connect()
  .then(() => client.db('admin').command({
    replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] },
  }))
  .then(console.log, console.error)
  .finally(() => client.close());
```
</details>

### 2. Install and run

```bash
npm install
npm run seed     # optional, but recommended — see below
npm run dev
```

Web app on `http://localhost:3000`, API on `http://localhost:4000`.

### 3. (Optional) apply index migrations

```bash
npm run migrate -w apps/api
```

Mongoose's `autoIndex` already creates the same indexes automatically in dev, so this isn't required to get the app working locally. It exists to give a fresh environment (a new deployment target, say) a versioned, explicit, repeatable path to the same schema, independent of whatever `autoIndex` happens to do.

### Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `MONGO_URI` | `mongodb://localhost:27017/equipment_ledger?replicaSet=rs0` | API, seed, invariant checker |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Web |

---

## Seeding

```bash
npm run seed
```

Deterministic and repeat-safe: it always drops and rebuilds the collections it owns, so running it twice never doubles the store, and the same command always produces the same story (which asset is out of service, which worker has an expired certification, which movement was corrected, and so on) — only the absolute timestamps shift to stay anchored around "now," so the seeded data, and the overdue and outstanding items in it, always looks current whenever you run it.

## Testing

```bash
npm test
```

Runs the full suite — unit, integration, and concurrency tests — against an ephemeral, in-memory MongoDB replica set (`mongodb-memory-server`) that spins up automatically for the run. No Docker or persistent database needed just to run tests, unlike the commands above.

Always invoked with `--runInBand`: several test files share that one in-memory instance, and Jest's default parallel-worker mode would let unrelated files' setup and teardown race against each other on it.

## Invariant checks

```bash
npm run check-invariants
```

Independently replays the entire movement ledger and checks it against the live, denormalized asset state — "read the ledger straight out of Mongo and check it says the same thing the screens do," runnable any time, not just right after seeding. It also checks for double-open movements, overlapping active reservations, and correction-chain integrity. Exits non-zero and prints every violation it finds.

---

## Project layout

```
apps/
  api/                  NestJS API
    src/
      assets/           asset reads, out-of-service transitions
      movements/        issue, return, correct — the ledger writes
      reservations/     booking, overlap serialization, cancellation
      workers/          workers and their certifications
      store/            "state as of instant T" reconstruction
      domain/           pure logic: replay, intervals, certification, idempotency, retry
      schemas/          Mongoose schema classes
      scripts/          seed, check-invariants
    migrations/         migrate-mongo index migrations
  web/                  Next.js App Router front end
    src/app/            routes
    src/components/     UI components
    src/lib/            API client, formatting, shared view types
packages/
  shared/               Zod DTOs and enums shared by both apps
```

## API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/assets` | All assets with denormalized current state |
| `GET` | `/assets/:id` | One asset |
| `GET` | `/assets/:id/history` | That asset's movements, with corrections attached |
| `POST` | `/assets/:id/out-of-service` | Take out of service (optional reason) |
| `POST` | `/assets/:id/back-in-service` | Return to circulation |
| `POST` | `/movements/issue` | Issue to a worker |
| `POST` | `/movements/return` | Return (optionally straight to out-of-service) |
| `POST` | `/movements/:id/correct` | Append a correction to a movement |
| `GET` | `/reservations` | All reservations |
| `POST` | `/reservations` | Book a window |
| `POST` | `/reservations/:id/cancel` | Cancel a booking (optional reason) |
| `GET` | `/workers` | All workers, with what each is holding |
| `GET` | `/workers/:id` | One worker, with certifications and reservations |
| `PUT` | `/workers/:id/certifications/:code` | Add or renew a certification |
| `DELETE` | `/workers/:id/certifications/:code` | Remove a certification |
| `GET` | `/store?asOf=<ISO>` | The whole store's state at any instant (defaults to now) |

Every mutating request takes a client-generated `idempotencyKey`. Request and response bodies are validated by Zod schemas in `packages/shared`, so the front end and the API cannot drift apart on a shape.

## Data model

| Collection | Role |
| --- | --- |
| `movements` | Append-only ledger — the source of truth |
| `assets` | Denormalized current state, for fast reads |
| `workers` | Worker records with embedded certifications |
| `reservations` | Future bookings, with lifecycle status |
| `asset_locks` | Per-asset nonce, used to serialize reservation writes |

---

## The model, and why

- **Movements are the ledger.** The `movements` collection is an append-only log of things that actually happened (`ISSUE`, `RETURN`, `OUT_OF_SERVICE`, `BACK_IN_SERVICE`). Every movement carries both `occurredAt` (business time — when it happened, which a keeper can backdate) and `recordedAt` (system time — when it was written, never edited). Rejected requests (a refused issue, an out-of-service asset) are never written here — only things that actually happened go in the ledger.
- **Assets carry denormalized current state** (`status`, `currentHolderId`) purely for fast "who holds what right now" reads. It is never the source of truth — the invariant checker's whole job is proving it always agrees with what replaying the ledger produces.
- **Corrections are new records, not edits.** Fixing a wrongly logged time inserts a new movement referencing the original (`correctionOf`/`correctedBy`); the original is never mutated, so the history always shows that a mistake was made and fixed, not a rewritten past.
- **"As of" reconstruction** replays the ledger (substituting corrected values where a correction exists) up to any instant and derives the store's state at that moment — the same replay function backs both the historical `/store?asOf=` endpoint and the invariant checker, so there is exactly one implementation of "what does the ledger say happened" in the whole system.
- **Cancelling a reservation is a status change, not a delete.** `POST /reservations/:id/cancel` sets `status: CANCELLED` and stores the reason; the row stays, so "what was booked and then called off" is still answerable. The window frees itself as a side effect, because overlap detection only ever considers `ACTIVE` reservations. The write is a compare-and-set on the single reservation document (`status: ACTIVE` in the filter), so two simultaneous cancels can't both win — no transaction needed.
- **Certifications are worker attributes, not ledger events.** Adding, renewing (`PUT /workers/:id/certifications/:code`) or removing (`DELETE`) one writes no movement, and none of it is retroactive: a past `ISSUE` stands as the record of what happened and a worker keeps any asset already in hand — only the *next* issue sees the change. Codes are unique per worker (the add is guarded by a `certifications.code: { $ne: code }` filter, so concurrent adds can't duplicate one), which keeps the certification check's lookup-by-code unambiguous.
- We used **Mongoose** (code-first schema classes, the same spirit as EF Core entity classes) with **migrate-mongo** for index/replica-set migrations, rather than Prisma — Prisma's MongoDB connector doesn't expose the raw `findOneAndUpdate`-with-filter and manual transaction-session control the concurrency mechanics below need.

## How concurrent issue is made impossible, and what it costs

**"One holder, ever" is enforced by a single MongoDB document update, not a lock:**

```ts
Asset.findOneAndUpdate(
  { _id: assetId, status: 'IN_STORE' },
  { $set: { status: 'ISSUED', currentHolderId, currentMovementId } },
)
```

MongoDB guarantees single-document updates are atomic. Under two simultaneous issue requests for the same asset, exactly one query matches `status: 'IN_STORE'` and succeeds; the other matches nothing and gets a clean `409`. That's the literal line that makes double-issue impossible — no lock, no transaction, no race window, and it costs nothing beyond the write you'd do anyway. The Movement insert happens in a short transaction alongside this update purely so the audit trail and live state can never diverge on a crash — the transaction is a consistency device here, not the concurrency control.

**Reservation overlap** can't use the same trick, because "no overlap" is a check against a *range of other documents*, not an equality check on one document. Instead, every reservation write first bumps a per-asset `asset_locks` nonce inside a transaction — giving two concurrent reservation attempts on the same asset something to write-conflict on, so MongoDB aborts and retries the loser — before checking for an overlapping window and inserting. Net effect: reservation creation is serialized per asset without a hand-rolled lock/timeout system.

**Cost:** MongoDB transactions require a replica set even for a single node, and reservation writes retry on transient write-conflict rather than always succeeding on the first attempt.

**Idempotency:** every mutating request carries a client-generated `idempotencyKey`, unique-indexed on `movements` and `reservations`. A retry with the same key hits a duplicate-key error, which is interpreted as "already applied" and returns the original result — this is what makes a double-click, a retried request, or a refresh mid-submit land exactly once.

## What's knowingly left out

- **Corrections fix timing and detail, not "this movement shouldn't have happened at all."** There's no reversal-movement type — a correction can move a return's time, but not un-issue an asset that was issued in error. A real reversal design would need its own state-machine thinking about what "undo" means once other movements have happened after it.
- **No bitemporal "what did we believe at time T" queries** — only business-time ("what was actually true at time T") reconstruction, which is what the brief asks for. A system-time axis (tracking what the ledger *looked like* to a past query, before later corrections) would need every read to also pin a `recordedAt` cutoff, not just `occurredAt`.
- **Reservation `EXPIRED` status is computed lazily on read**, not by a background job — there's nothing in this system that needs to fire on a schedule at this scale.
- **No auth, roles, or permissions** — per the brief's own scope discipline. The keeper/worker "pick a name from a list" flow is cosmetic identification, not access control.
- **Movement DTOs don't reject a future-dated `occurredAt`.** `IssueMovementDto`/`ReturnMovementDto`/etc. only validate that `occurredAt` is a well-formed timestamp, not that it's in the past — so a movement backdated into the future is technically reachable via the API (though not from any current UI or seed data), and in a contrived case could cause `check-invariants`' `replay-matches-live-state` check to report a mismatch, since it always replays "as of now." Known gap, not fixed in this pass.

## What I'd do with another day

1. **Reversal movements** — a proper "this issue should never have happened" undo, distinct from a timing correction, with its own effect on current state.
2. **A materialized snapshot for `/store?asOf=`** if the ledger grew past the point where an in-memory replay over an indexed query stays single-digit milliseconds — not needed at this seed's scale, but the first thing I'd profile before it became one.
3. **Real auth and a keeper entity** — right now "who's on the hatch" is a cosmetic, unauthenticated label; a real deployment needs it to be an actual identity.
4. **A small reservation-to-issue handoff UI** — right now issuing against a reservation works via the API (`reservationId` on the issue request), but the dashboard doesn't yet surface "issue this asset against its upcoming reservation" as a one-click action from the reservations list.
