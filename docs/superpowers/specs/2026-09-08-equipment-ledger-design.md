# The Equipment Ledger — Design

**Status:** Approved for implementation
**Source brief:** `fullstack-technical-test-equipment-ledger.html` (full-stack technical test, Next.js / NestJS / MongoDB / TypeScript)

## 1. Purpose

A site store where a store keeper issues and receives back physical equipment (drills, harnesses, gas detectors, etc.) to/from workers. The system must guarantee, provably and under real concurrency:

1. **One holder, ever** — an asset is held by at most one worker at any instant, including when two requests race.
2. **Reservations don't overlap** — no two reservations on the same asset share a minute.
3. **Certification gates issue** — an asset requiring a certification refuses issue if the worker's certification is expired at issue time.
4. **Out of service is real** — an unserviceable asset can't be issued or newly reserved; standing reservations against it are resolved, not left dangling.
5. **Late entries** — a movement's business time (`occurredAt`) and system time (`recordedAt`) are distinct fields.
6. **Corrections, not erasures** — a wrongly recorded movement is fixed by a new record referencing the original; the original is never mutated or hidden.
7. **Nothing lands twice** — retries/double-clicks/refreshes produce exactly one movement.
8. **Any instant, answerable** — "who held what at time T" is answered by replaying the ledger, not a cache.

Everything else (page count, API shape, exact schema) is a judgment call, documented here and in the eventual README.

Explicitly out of scope (per brief): authentication, roles/permissions, email, file uploads, barcode scanning, mobile app, multi-site.

## 2. Architecture

npm workspaces monorepo:

- `apps/web` — Next.js (App Router, TypeScript). Server components for initial page loads, client components for interactive forms/modals.
- `apps/api` — NestJS (TypeScript). REST API, all business logic and invariant enforcement.
- `packages/shared` — TS types/DTOs and zod schemas shared between both apps (movement types, enums, request/response shapes).

**Infra:** `docker-compose.yml` runs MongoDB only, configured as a single-node replica set (`--replSet rs0`, with an init step that runs `rs.initiate()` on first boot) — required because the reservation-overlap mechanism uses multi-document transactions. Next.js and NestJS run natively (`npm run dev` at the root, via workspace scripts), against the Dockerized Mongo.

**Persistence layer:** Mongoose, via `@nestjs/mongoose`. Schema classes (`@Schema()`/`@Prop()`) are the single source of truth for document shape and indexes — the code-first model, analogous to EF Core entity classes. Unlike a relational ORM, MongoDB has no DDL to diff against, so there is no auto-generated migration step; `migrate-mongo` (plain `up`/`down` files tracked in a `changelog` collection) handles the things that do need versioned, repeatable application: index creation, the replica-set init, and any future data-shape changes. Mongoose's `autoIndex` keeps dev iteration unblocked without waiting on a manual migration run.

Prisma was considered (closer to a single-schema-file EF Core feel) but rejected: its MongoDB connector doesn't expose raw `findOneAndUpdate`-with-filter semantics or manual transaction sessions as directly as Mongoose does, and that raw control is required for the concurrency mechanics below.

## 3. Data model

**`assets`**
- `_id` (string, natural key, e.g. `HARN-014`)
- `kind` (string)
- `requiresCertification` (string | null)
- `status`: `IN_STORE | ISSUED | RESERVED | OUT_OF_SERVICE` — denormalized, authoritative only for "right now"; always re-derivable from `movements`.
- `currentHolderId` (string | null)
- `currentMovementId` (ObjectId | null) — the open (unreturned) movement.
- `updatedAt` (Date) — debugging only, never used for business logic.

**`workers`**
- `_id` (string, name-derived slug)
- `name` (string)
- `certifications`: `[{ code, expiresAt }]`

**`movements`** — the ledger. Append-only; a written document is never mutated.
- `_id` (ObjectId)
- `assetId`, `workerId`
- `type`: `ISSUE | RETURN | OUT_OF_SERVICE | BACK_IN_SERVICE`
- `occurredAt` (Date) — business time, keeper-entered, can be backdated.
- `recordedAt` (Date) — system time at insert, immutable.
- `idempotencyKey` (string, unique index)
- `correctionOf` (ObjectId | null) — set if this movement corrects an earlier one.
- `correctedBy` (ObjectId | null) — set on the original once corrected.
- `reason` (string | null)

Rejected requests (certification refusal, "asset not in store," etc.) are **not** stored as movements — only things that actually happened go in the ledger; refusals are plain API error responses.

**`reservations`**
- `_id` (ObjectId)
- `assetId`, `workerId`
- `startAt`, `endAt` (Date)
- `status`: `ACTIVE | CANCELLED | FULFILLED | EXPIRED` (`EXPIRED` computed lazily on read, not via a scheduled job)
- `idempotencyKey` (string, unique index)

**`asset_locks`**
- `_id` = assetId
- `nonce` (number) — bumped by every reservation write; exists only to give Mongo's transaction write-conflict detection something to trip on (see §4).

## 4. Concurrency & idempotency

**Issue/return/out-of-service** are enforced by a single-document atomic compare-and-swap: `Asset.findOneAndUpdate({ _id: assetId, status: 'IN_STORE' }, { $set: { status: 'ISSUED', ... } })`. MongoDB guarantees single-document update atomicity, so under two simultaneous issue requests exactly one matches the filter and succeeds; the other matches nothing and returns `409`. This is the literal, costless enforcement of "one holder, ever" — no lock, no transaction needed for the invariant itself. The matching Movement insert happens in a short transaction alongside the Asset update purely so state and audit trail can never diverge on a crash — the transaction is a consistency device, not the concurrency control.

**Reservation overlap** can't use a single-document CAS (it's a check against a range of *other* documents). Instead: within a transaction, first `findOneAndUpdate` the asset's `asset_locks` document (bumping `nonce`) — this gives two concurrent transactions on the same asset something to write-conflict on, so MongoDB aborts and retries one of them. The winner then checks for any `ACTIVE` reservation with an overlapping window and inserts if none exists, all inside the same transaction. Net effect: reservation creation is serialized per-asset without needing a hand-rolled lock/timeout system.

**Idempotency**: every mutating request carries a client-generated `idempotencyKey`, unique-indexed on `movements`/`reservations`. A retry with the same key hits a duplicate-key error, which the API interprets as "already applied" and returns the original result rather than erroring or double-applying.

**Cost paid for this design**: MongoDB transactions require a replica set even for a single node (handled in Compose config); reservation writes retry on transient write-conflict rather than always succeeding on the first attempt.

## 5. Core write paths

**Issue** (`POST /movements/issue` — `assetId`, `workerId`, `occurredAt?`, `idempotencyKey`, `reservationId?`)
1. If the asset requires a certification, check the worker holds one with `expiresAt > occurredAt`; if not, `422` with a human-readable reason. No movement written.
2. Idempotency check.
3. Transaction: atomic CAS `IN_STORE → ISSUED` (no match → `409`); insert `ISSUE` movement; if against a reservation, mark it `FULFILLED`.
4. Retry a few times on transient write-conflict before surfacing `409`.

**Return** (`POST /movements/return` — `assetId`, `workerId`, `occurredAt?`, `idempotencyKey`, `outOfService?`)
1. Idempotency check.
2. Atomic CAS filtered on `status: 'ISSUED'` **and** `currentHolderId: workerId` — so "wrong worker returns it" fails atomically, not via a separate check-then-act race. No match → `409`.
3. New status: `OUT_OF_SERVICE` if `outOfService`, else `IN_STORE`.
4. Insert `RETURN` movement (and `OUT_OF_SERVICE` movement, same `occurredAt`, if applicable), referencing the open `ISSUE` movement.
5. `occurredAt` validated ≥ the open movement's `occurredAt` — backdating a return before its own issue is rejected at the API layer.

**Correction** (`POST /movements/:id/correct` — corrected fields, `idempotencyKey`)
1. Original must exist and be uncorrected (`correctedBy == null`).
2. Insert a new movement with `correctionOf: originalId` and the corrected fields; original's fields stay untouched.
3. Set `correctedBy` on the original, same transaction.
4. Scope: corrections fix *when*/details, not *whether* — a correction never re-runs the Asset status CAS. "The movement itself was wrong" (needs reversal) is explicitly out of scope; documented as a known gap.

**Reserve** (`POST /reservations` — `assetId`, `workerId`, `startAt`, `endAt`, `idempotencyKey`)
1. Reject `endAt <= startAt` and windows starting in the past, before touching the DB.
2. Transaction: bump `asset_locks` nonce → check for overlapping `ACTIVE` reservation → insert if none (`409` with the conflicting window if one exists). Asset must not be `OUT_OF_SERVICE`.

**Out of service**
- While `ISSUED`: allowed — modeled as a return-with-`outOfService`, i.e. "it came back, and it came back broken."
- While `IN_STORE` with standing `ACTIVE` reservations: those reservations are auto-cancelled (`status: CANCELLED`, with a reason) in the same transaction — a documented judgment call rather than leaving them dangling.

## 6. Read paths

**Current state** (`GET /assets`, `GET /assets/:id`) — reads directly from the denormalized `Asset` document; no replay. `RESERVED` display annotation is computed lazily against `ACTIVE` reservation windows.

**Asset history** (`GET /assets/:id/history`) — full movement list, `recordedAt`-ordered, corrections shown paired with what they corrected.

**"As of" reconstruction** (`GET /store?asOf=<ISO timestamp>`):
1. Load movements with *effective* `occurredAt <= asOf` — "effective" means a corrected movement uses the correction's fields, not the original's.
2. Replay per asset, ordered by `(occurredAt, _id)`: `ISSUE` sets holder, `RETURN`/`OUT_OF_SERVICE` clears it. Last event at-or-before `asOf` is the answer.
3. Plain in-memory replay over an indexed query (`{ assetId: 1, occurredAt: 1 }`) — at seed scale (low thousands of movements) this is single-digit milliseconds; no snapshotting is built, and this reasoning is stated in the README rather than over-engineered around.
4. `asOf` before the store's first movement → valid answer (everything in store). Exactly on a movement's timestamp → inclusive (`<=`).
5. The same replay function backs both this endpoint and the invariant checker (§8), which replays to *now* and diffs against live `Asset` state — proving the screens and the raw ledger never disagree.

## 7. Frontend

Single persona (the store keeper). A lightweight, non-authenticated "who's on the hatch" picker (fixed list, not a modeled entity) sets a `loggedBy` attribution string on movements — cosmetic only.

- **`/`** — store dashboard: asset grid, status-colored, filter/search, row actions (Issue/Return/Take out of service).
- **`/assets/[id]`** — detail: status, holder, actions, full history timeline with inline corrections and a "Correct this entry" action.
- **`/workers/[id]`** — certifications (expired flagged), current holdings, reservations.
- **`/reservations`** — create/list; overlap rejection surfaces the conflicting window.
- **`/history`** — the "as of" screen: timestamp picker + "now" shortcut, rendered as the same store-grid visual reconstructed at that instant.

Mechanics:
- Idempotency key generated once per form/modal open, reused across retries of that submission; submit disables immediately on click.
- Pessimistic UI: no optimistic updates. Every mutation shows a pending state, waits for the real response, and refetches current state afterward regardless of outcome — required given the brief's "kill the API mid-request" test.
- Server components for initial loads, client components for interactive mutations. Tailwind base; an actual visual design pass happens during implementation, not pinned in this spec.

## 8. Seed data & invariant tooling

- **Determinism** = same structural story every run (a fixed seeded PRNG picks which asset is out of service, which worker has the expired cert, which movement is late-logged/corrected, etc.), anchored to "now" at seed time rather than a frozen calendar date — an overdue item stays freshly overdue whenever the seed is actually run. Documented as a deliberate interpretation of "deterministic."
- **Repeat-safety** = full reset: seeding drops exactly the collections it owns (`assets`, `workers`, `movements`, `reservations`, `asset_locks`) and rebuilds from scratch every run.
- Produces: ~60 assets (several kinds, some cert-gated, ≥1 out of service); ~12 workers (one expired cert, one expiring inside the window); 30 days of movements (ordinary traffic, a few outstanding, ≥1 overdue, ≥1 late-logged, ≥1 correction); reservations past/future including one never collected.
- **`npm run check-invariants`**: replays the ledger independently of the write path and asserts, against raw Mongo data: (1) replayed current-state matches every `Asset.status`/`currentHolderId` exactly; (2) no asset has more than one open movement at once; (3) no two `ACTIVE` reservations on the same asset overlap; (4) every correction references a real, once-only-corrected original. Non-zero exit + printed report on violation; runnable any time, not just post-seed.

## 9. Testing strategy

- **Unit** (Jest, no DB): certification-expiry check, interval-overlap test, replay/reconstruction algorithm, correction-chain resolution.
- **Concurrency integration** (Jest against the real Dockerized Mongo): `Promise.all` of N simultaneous issue requests for one asset — assert exactly one succeeds; same for overlapping concurrent reservations. This is the category that matters most given the brief's emphasis.
- **Scripted end-to-end pass**: the brief's "main scenario" verbatim (issue → concurrent issue rejected → backdated return → correction → as-of query), using named seeded asset/worker codes — doubles as the screen-recording rehearsal script.
- Frontend testing stays light (idempotency-key behavior, error-message surfacing), matching the brief's steer toward correctness over UI breadth.

## 10. Deliverables mapping

- Git history: incremental commits as each piece lands (domain model → concurrency mechanics → API → frontend → seed → invariant tooling → polish), not a single dump.
- README: run instructions for both apps, seed command, invariant-check command, the model chosen and why, exactly how concurrent issue is made impossible and what it costs, what's left for another day, and what's knowingly out of scope (reversal-style corrections for "the movement itself was wrong," bitemporal "what did we believe at time T" queries, real auth).
- Screen recording (2–3 min): issue, a refused issue, a backdated return, a correction, and the as-of answer — against the deterministic seed so specific asset/worker codes can be named in advance.

## 11. Known, deliberate gaps (documented, not accidental)

- Corrections fix timing/detail, not "this movement shouldn't have happened" — no reversal-movement type.
- No bitemporal "what did the system believe at time T" queries — only business-time ("what was true at T") reconstruction, which is what the brief actually asks for.
- Reservation `EXPIRED` status is computed lazily on read, not via a background job — acceptable since nothing needs to fire off-schedule at this scope.
- No auth/roles — per brief, out of scope.
