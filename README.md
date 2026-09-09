# The Equipment Ledger

A site-store equipment ledger: issue and return tools to workers, reserve them ahead of time, and answer "who held what at any past instant" — provably correct under real concurrency, not just in the happy path.

## Stack

Next.js (App Router) + NestJS + MongoDB + TypeScript, in an npm workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`).

## Running it

1. Start MongoDB (a single-node replica set, required for the transactions the concurrency guarantees below depend on):
   ```bash
   docker compose up -d
   ```
2. Install dependencies and run both apps:
   ```bash
   npm install
   npm run dev
   ```
   API on `http://localhost:4000`, web app on `http://localhost:3000`.

## Seeding

```bash
npm run seed
```

Deterministic and repeat-safe: it always drops and rebuilds the collections it owns, so running it twice never doubles the store, and the same command always produces the same story (which asset is out of service, which worker has an expired certification, which movement was corrected, etc.) — only the absolute timestamps shift to stay anchored around "now," so the seeded data (and the overdue/outstanding items in it) always looks current whenever you run it.

## Testing

```bash
npm test
```

Runs the full test suite (unit, integration, and concurrency tests) against an ephemeral, in-memory MongoDB replica set (`mongodb-memory-server`) that spins up automatically for the test run — no Docker or persistent database needed just to run tests, unlike the commands above. Always invoked with `--runInBand`: several test files share that one in-memory instance, and Jest's default parallel-worker mode would let unrelated files' setup/teardown race against each other on it.

## Invariant checks

```bash
npm run check-invariants
```

Independently replays the entire movement ledger and checks it against the live, denormalized asset state — this is "read the ledger straight out of Mongo and check it says the same thing the screens do," runnable any time, not just right after seeding. It also checks for double-open movements, overlapping active reservations, and correction-chain integrity. Exits non-zero and prints every violation it finds.

## The model, and why

- **Movements are the ledger.** The `movements` collection is an append-only log of things that actually happened (`ISSUE`, `RETURN`, `OUT_OF_SERVICE`, `BACK_IN_SERVICE`). Every movement carries both `occurredAt` (business time — when it happened, which a keeper can backdate) and `recordedAt` (system time — when it was written, never edited). Rejected requests (a refused issue, an out-of-service asset) are never written here — only things that actually happened go in the ledger.
- **Assets carry denormalized current state** (`status`, `currentHolderId`) purely for fast "who holds what right now" reads. It is never the source of truth — the invariant checker's whole job is proving it always agrees with what replaying the ledger produces.
- **Corrections are new records, not edits.** Fixing a wrongly logged time inserts a new movement referencing the original (`correctionOf`/`correctedBy`); the original is never mutated, so the history always shows that a mistake was made and fixed, not a rewritten past.
- **"As of" reconstruction** replays the ledger (substituting corrected values where a correction exists) up to any instant and derives the store's state at that moment — the same replay function backs both the historical `/store?asOf=` endpoint and the invariant checker, so there is exactly one implementation of "what does the ledger say happened" in the whole system.
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

**Cost:** MongoDB transactions require a replica set even for a single node (handled in `docker-compose.yml`), and reservation writes retry on transient write-conflict rather than always succeeding on the first attempt.

**Idempotency:** every mutating request carries a client-generated `idempotencyKey`, unique-indexed on `movements` and `reservations`. A retry with the same key hits a duplicate-key error, which is interpreted as "already applied" and returns the original result — this is what makes a double-click, a retried request, or a refresh mid-submit land exactly once.

## What's knowingly left out

- **Corrections fix timing and detail, not "this movement shouldn't have happened at all."** There's no reversal-movement type — a correction can move a return's time, but not un-issue an asset that was issued in error. A real reversal design would need its own state-machine thinking about what "undo" means once other movements have happened after it.
- **No bitemporal "what did we believe at time T" queries** — only business-time ("what was actually true at time T") reconstruction, which is what the brief asks for. A system-time axis (tracking what the ledger *looked like* to a past query, before later corrections) would need every read to also pin a `recordedAt` cutoff, not just `occurredAt`.
- **Reservation `EXPIRED` status is computed lazily on read**, not by a background job — there's nothing in this system that needs to fire on a schedule at this scale.
- **No auth, roles, or permissions** — per the brief's own scope discipline. The keeper/worker "pick a name from a list" flow is cosmetic identification, not access control.

## What I'd do with another day

1. **Reversal movements** — a proper "this issue should never have happened" undo, distinct from a timing correction, with its own effect on current state.
2. **A materialized snapshot for `/store?asOf=`** if the ledger grew past the point where an in-memory replay over an indexed query stays single-digit milliseconds — not needed at this seed's scale, but the first thing I'd profile before it became one.
3. **Real auth and a keeper entity** — right now "who's on the hatch" is a cosmetic, unauthenticated label; a real deployment needs it to be an actual identity.
4. **A small reservation-to-issue handoff UI** — right now issuing against a reservation works via the API (`reservationId` on the issue request), but the dashboard doesn't yet surface "issue this asset against its upcoming reservation" as a one-click action from the reservations list.
