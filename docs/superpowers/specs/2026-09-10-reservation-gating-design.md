# Reservation Gating & Due Dates — Design

**Status:** Approved for implementation
**Date:** 2026-09-10
**Supersedes parts of:** `2026-09-08-equipment-ledger-design.md` (§3 data model, §5 write paths, §8 seed)

## 1. Why

Reservations were a standalone claim: `reserve()` refused overlapping windows, and nothing else
consulted them. `issue()` checked the worker, the certification and that the asset was
`IN_STORE` — never whether somebody had already booked it. So an asset reserved for Worker A
could be, and was, issued to Worker B for the same hours. The seed contained exactly that state
(`GASD-060` reserved for Chidi, issued to Farid), which reads like the system auto-issuing a
reservation to the wrong person. Nothing auto-issues; there is no scheduler in the system. The
appearance came entirely from the missing gate.

A booking that does not stop anyone taking the asset is decoration. This design makes a
reservation constrain issuing and issuing constrain reserving, ties the two together through a
shared due-back time, and gives a reservation's own lifecycle the two endings it was missing:
nobody collected it, and nobody brought it back.

## 2. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | An issue overlapping another worker's `ACTIVE` reservation is refused | The point of a booking |
| D2 | An issue by the reserving worker whose loan overlaps their own window *collects* it | Otherwise the keeper can issue inside a booking without the record linking them |
| D3 | Collecting pins `dueAt` to the reservation's `endAt`, not shortenable | The booking already states when the asset is free again; a shorter loan would let the asset read as returned-on-time while the window it belongs to is still open. One time, one meaning |
| D4 | A non-collecting issue must be due back at or before the next reservation's start | The asset has to be on the shelf when its next holder arrives |
| D5 | If that leaves under 30 minutes, a **non-collecting** issue is refused outright | A loan that must come straight back is not a loan; the keeper can cancel a stale booking instead. Never applied to collection: a worker collecting the last ten minutes of their own booking is legitimate |
| D6 | A reservation is refused if the asset is out on an issue due back after the requested start | The mirror of D4, checked from the other side |
| D7 | `dueAt` is required on every issue | Overdue is only answerable if every loan says when it ends. Removes the "no due time, never overdue" branch |
| D8 | `NOT_COLLECTED` and `OVERDUE` are derived on read, never stored | Same reason asset overdue is derived: no writer, only the clock. Consistent with the existing `EXPIRED` derivation this replaces |
| D9 | `issue()` bumps the per-asset `AssetLock` | Issuing now depends on reservations and reserving on open issues; without a shared write point the two can commit concurrently past each other's checks |
| D9b | A correction may not change `dueAt` on an issue that collected a reservation | Otherwise D3 is bypassable one step later: pin the due date at issue, move it by correction. The booking still states when the asset is free |
| D10 | `AssetStatus.RESERVED` is deleted | Dead value nothing has ever written. With real gating, "reserved" is the upcoming-reservation column, not an asset status |

## 3. Reservation lifecycle

**Stored:** `ACTIVE`, `FULFILLED`, `CANCELLED`.

**Derived at read time**, replacing the stored value in every response:

| Reads as | When | Label |
| --- | --- | --- |
| `NOT_COLLECTED` | stored `ACTIVE`, `endAt` < now | "Not collected" |
| `OVERDUE` | stored `FULFILLED`, `endAt` < now, and the collecting issue is still open | "Overdue" |

`EXPIRED` is removed: it described precisely the `NOT_COLLECTED` condition under a name that did
not say what had happened.

"The collecting issue is still open" is answered from the link in §4 plus the asset's
`currentMovementId`, in one batched lookup per read — the same shape `AssetsService.findAll`
already uses for `dueAt`, not a query per reservation.

## 4. Data model changes

**`reservations`** gains:
- `fulfilledByMovementId: ObjectId | null` — the issue that collected this booking.

**`movements`** gains:
- `reservationId: ObjectId | null` — the booking this issue collected. Only ever set on `ISSUE`.

The two are the same link from both ends, like the existing `correctionOf`/`correctedBy` pair, so
reads stay cheap in both directions and §8's invariant can prove they agree.

`dueAt` on `movements` is unchanged in shape (`Date | null`) but is now non-null on every `ISSUE`
the API writes; the nullability stays for the other movement types, which have nothing to be due.

## 5. The issue path

`POST /movements/issue` takes `{ assetId, workerId, dueAt (required), occurredAt?, loggedBy?, idempotencyKey }`.
`reservationId` is **removed** from the request: collection is inferred, never asserted by the caller.

Order of evaluation, all inside the existing transaction unless noted:

1. Worker and asset exist; certification valid at `occurredAt` (unchanged, pre-transaction).
2. `dueAt` strictly after `occurredAt` (existing rule, now on a required field).
3. Bump `asset_locks` nonce for this asset (D9).
4. Read `ACTIVE` reservations for the asset overlapping `[occurredAt, dueAt]`.
   - Any belonging to a **different** worker → `409`, naming that worker and window.
   - One belonging to **this** worker → this issue collects it. `dueAt` must equal its `endAt`,
     else `422` (D3). Set `FULFILLED` + `fulfilledByMovementId`, and `reservationId` on the movement.
5. **Only if this issue collects nothing** (a collecting issue is already bounded by its own
   window, and no other reservation can overlap it): read the next `ACTIVE` reservation for the
   asset by a different worker starting at or after `occurredAt`.
   - `dueAt` after its `startAt` → `422`, naming the window (D4).
   - `startAt - occurredAt < 30 minutes` → `409` (D5), naming the window, before the keeper has to
     discover it by picking a due date.
6. CAS `assets.status` `IN_STORE → ISSUED` (unchanged — this is still what makes double-issue
   impossible), write the movement.

A worker whose window has already passed gets an ordinary issue with a keeper-chosen due date; the
reservation stays `NOT_COLLECTED`, because it was not collected. Both facts stay in the record.

### Corrections

A correction to an issue that collected a reservation is refused if it changes `dueAt` (D9b); the
time comes from the booking, and the refusal says so. Corrections otherwise behave as they do
today, including the ordering rule. A correction inherits the original movement's
`reservationId` so a replay sees the same collection, while `fulfilledByMovementId` keeps
pointing at the original movement — §8's link invariant resolves through the correction chain
rather than expecting two movements to claim one booking.

## 6. The reserve path

`POST /reservations` additionally refuses when the asset is out on an open issue whose `dueAt` is
after the requested `startAt` (D6), naming the holder and the due time. The check reads the asset's
`currentMovementId` inside the transaction that already bumps `asset_locks`, so it serialises
against a concurrent issue by construction.

Deliberate consequence: an asset that is **overdue** can still be reserved, since every future
window starts after its lapsed due time. The keeper sees the overdue flag on the asset and decides;
refusing instead would let one unreturned asset block its own future indefinitely.

Out-of-service handling, overlap detection between reservations, and cancellation are unchanged.

## 7. Concurrency

`issue()` now writes `asset_locks` as well as `assets` and `movements`. Two consequences, both
stated in the README rather than left for a reader to discover:

- An issue and a reservation racing on one asset now write a common document, so MongoDB aborts one
  with a `TransientTransactionError` and `withRetries` re-runs it against committed state. Without
  this, `issue()` read reservations it could not conflict with and a reservation could land in the
  window an in-flight issue had just claimed.
- Issuing is no longer free: it writes one extra document and can retry under contention. The
  README's "costs nothing beyond the write you'd do anyway" is no longer true and is corrected.

**Unchanged:** "one holder, ever" still rests entirely on the single-document CAS on
`assets.status`. The lock bump serialises the *reservation* cross-checks; it is not what prevents
double-issue, and the CAS is not weakened by it.

## 8. Invariants

`check-invariants` gains two rules:

- `reservation-collection-link` — `reservations.fulfilledByMovementId` and `movements.reservationId`
  agree in both directions; a `FULFILLED` reservation has a collecting movement, and a movement
  with a `reservationId` is an `ISSUE`.
- `no-reservation-held-by-another` — replaying the ledger, no `ACTIVE` or `FULFILLED` reservation's
  window overlaps a period when a **different** worker held the asset.

The second makes the rule this design is for checkable against the ledger itself, not merely
enforced at the door — the same standard the existing "one holder" and overlap rules are held to.

## 9. Seed

- Every seeded `ISSUE` carries a `dueAt` (D7). Outstanding loans keep a near-future one; the
  deliberately overdue asset keeps its past one.
- The ordinary-traffic loop no longer issues an asset inside somebody else's reservation window,
  so the state that prompted this design cannot be generated.
- Two scenarios are added, both required by §3 having endings the old model could not express:
  a booking whose window passed uncollected (`NOT_COLLECTED`), and a booking collected and not yet
  returned past its window (`OVERDUE`).
- Determinism and repeat-safety are unchanged.

## 10. Frontend

- **Issue modal:** it loads `GET /reservations` on open (the whole list, as the reservations page
  already does — a few dozen rows at this scale) and filters to this asset, so it can react to the
  chosen worker without a new endpoint. Due-back becomes required. When the chosen worker has a reservation on the asset
  covering the loan, the field is filled with the window's end, locked, and labelled with why. When
  another worker holds the window, the modal says so before the keeper submits.
- **Reservations table:** the status badge gains "Not collected" (amber, nobody came) and "Overdue"
  (red, nothing came back). "Expired" disappears with the status it named.
- **Reservation form:** refusal from D6 is shown with the holder and due time, alongside the
  existing overlap message.

## 11. Constants

`MIN_LOAN_BEFORE_RESERVATION = 30 minutes` (D5) lives in `packages/shared` beside the DTOs, so the
modal can explain the refusal in the same terms the API applies it.

## 12. Out of scope

- No background job promotes anything: `NOT_COLLECTED` and `OVERDUE` are read-time derivations, and
  nothing in the system needs to fire on a schedule.
- No partial or early return of a collected reservation frees its remaining window; the window
  stands until it ends or is cancelled.
- No notion of a reservation queue, priority, or waitlist.
- Certification is not re-checked at collection time against the reservation's window — it is
  checked at issue, as now.
