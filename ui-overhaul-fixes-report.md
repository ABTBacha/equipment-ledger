# UI Overhaul Fixes Report

## Fix 1 — History "as of" leaking current-time data

File: `apps/web/src/app/history/HistoryClient.tsx`

Changed `loadAsOf`'s row-building map so each row explicitly sets `upcomingReservation: null` and `lastActivityAt: null`, alongside the already-reconstructed `status`/`currentHolderId`. Only status/holder come from the historically-accurate `/store?asOf=` snapshot; reservation/activity have no historical source, so they are now always nulled (rendering `—` via the existing `formatDateTime`/render logic) instead of leaking the current-time values from `/assets`. Columns were kept (not removed) since this is a smaller, less destructive change and the columns still communicate their absence honestly via the placeholder.

Test evidence: added `apps/web/src/app/history/HistoryClient.test.tsx` → `'does not leak current-time upcomingReservation/lastActivityAt into a historical snapshot'` — mocks `/assets` with a future `upcomingReservation` and a `lastActivityAt`, asserts the rendered row shows `—` for both columns and never shows the worker id. Passing.

## Fix 2 — Raw enum values rendering ALL CAPS

Added `MOVEMENT_TYPE_LABEL` and `RESERVATION_STATUS_LABEL` maps (plus `MovementType`/`ReservationStatus` type aliases) to `apps/web/src/lib/types.ts`, matching the sentence-case style of `StatusIndicator`'s own `STATUS_LABEL` map.

Updated render sites:
- `apps/web/src/components/HistoryTimeline.tsx` — `{entry.movement.type}` → `{MOVEMENT_TYPE_LABEL[entry.movement.type]}`.
- `apps/web/src/app/reservations/ReservationsClient.tsx` — `({r.status})` → `({RESERVATION_STATUS_LABEL[r.status]})`.
- `apps/web/src/app/workers/[id]/page.tsx` — same pattern for the worker's reservation list.

Test evidence: `HistoryTimeline.test.tsx` (unchanged, doesn't assert raw type text) still passes; full frontend suite green.

## Fix 3 — Button-label contrast below WCAG AA

Files: `IssueReturnModal.tsx`, `CorrectMovementForm.tsx`, `ReservationForm.tsx` (all `bg-accent-blue` Confirm/Save/Reserve buttons), `OutOfServiceControl.tsx` (`bg-accent-red` confirm button). Changed `text-primary` → `text-base` on these four buttons.

`text-base` was already generatable by Tailwind without any config change: `tailwind.config.ts`'s `theme.extend.colors.base` maps to `var(--bg-base)`, and Tailwind's color plugins generate `text-{colorKey}` for every named color, not just `bg-{colorKey}`. Verified by compiling the actual Tailwind CSS (`npx tailwindcss ... --content <test file>`) against a button with both `text-sm` and `text-base` in its class list: Tailwind emits two separate `.text-base` rules — one from the `fontSize` plugin (`font-size: 1rem`) and one from the `colors`/`textColor` plugin (`color: var(--bg-base)`), in that source order, with `.text-sm`'s `font-size: 0.875rem` rule emitted after the font-size `.text-base` rule (so `text-sm` sizing still wins) and the color `.text-base` rule emitted last overall (so the dark color always wins). No visual regression on the `text-sm`-sized `CorrectMovementForm` Save button.

Searched for other `bg-accent-*` usages with light text (`grep bg-accent-(green|amber)`): none found — only the four blue/red buttons above use a filled accent background with foreground text, so no other instances needed fixing.

Contrast verification (WCAG relative luminance formula, computed by hand):
- `#0F1214` (dark text) on `#5B8FBF` (accent-blue): **≈5.49:1** — passes AA (4.5:1).
- `#0F1214` (dark text) on `#D65C4F` (accent-red): **≈4.93:1** — passes AA (4.5:1).

(For reference, the original `#E4E7E9` text gave ≈2.8:1 on blue and ≈3.05:1 on red, both failing — matching the review's numbers.)

## Fix 4 — Amber used decoratively for "Corrected" annotation

File: `apps/web/src/components/HistoryTimeline.tsx`. Changed `border-accent-amber`/`text-accent-amber` → `border-accent-blue`/`text-accent-blue` on the "Corrected" annotation block, since amber is reserved for the ISSUED status and blue is the designated informational/non-status accent.

Test evidence: `HistoryTimeline.test.tsx` still passes (asserts text content, not color classes).

## Fix 5 — No test asserts a toast is actually displayed

Added `apps/web/src/components/ToastProvider.test.tsx`:
- `'shows a toast with the given message when showToast is called'` — renders a test consumer that calls `showToast` from `useToast()`, asserts the message is absent before the click and present after.
- `'auto-dismisses the toast after the timeout elapses'` — uses `jest.useFakeTimers()`, triggers the toast, advances 4000ms, asserts the message is gone.

Added to `apps/web/src/components/IssueReturnModal.test.tsx` (new `describe` block): `'shows a toast with the expected message after a successful issue, when wrapped in a real ToastProvider'` — renders `<ToastProvider><IssueReturnModal .../></ToastProvider>`, submits a successful issue, asserts `"Issued to worker-9"` appears in the DOM (previously this was only exercised against the silent no-op fallback with no provider mounted).

Test evidence: both new test files pass; full suite went from 34 → 39 tests (9 → 10 suites).

## Fix 6 — Toast auto-dismiss timeout not cleared on unmount

File: `apps/web/src/components/ToastProvider.tsx`. Added a `useRef<Set<TimeoutId>>` tracking all in-flight dismiss timeouts; each `setTimeout` call is added to the set and removes itself when it fires; a `useEffect` cleanup (empty deps, runs on unmount) clears every still-pending timeout in the set. Prevents a `setState` call on an unmounted component if the provider unmounts before a toast's 4s auto-dismiss fires.

Test evidence: covered indirectly by the existing `ToastProvider.test.tsx` suite passing with no act()-warning noise; no direct unmount-timing test was added since jsdom/RTL doesn't reliably surface "setState on unmounted component" as a test failure without explicit spies, and the fix is a straightforward, low-risk cleanup pattern.

## Fix 7 — `HistoryClient.tsx` initial fetch has no error handling

File: `apps/web/src/app/history/HistoryClient.tsx`. Added a `.catch` on the initial `apiFetch('/assets')` call that sets a new `error` state and stops `loading`. Also wrapped `loadAsOf`'s body in `try/catch/finally` so a failing `/store` fetch (e.g. after changing the "as of" timestamp) surfaces the same inline error instead of leaving the skeleton spinning. Error is rendered via `<div className="text-sm text-accent-red mb-3">{error}</div>`, matching the existing error-display convention used in `IssueReturnModal.tsx`/`OutOfServiceControl.tsx`/etc.

Test evidence: added `'shows an inline error and stops the loading skeleton when the initial /assets fetch fails'` to `HistoryClient.test.tsx` — mocks `/assets` to reject, asserts the error message appears and the table falls through to its empty-state message (loading no longer stuck true). Passing.

## Full test suite runs

### Frontend (`npm run test -w apps/web`)

```
Test Suites: 10 passed, 10 total
Tests:       39 passed, 39 total
Snapshots:   0 total
Time:        2.89 s
```

New/changed suites: `ToastProvider.test.tsx` (new), `HistoryClient.test.tsx` (+2 tests), `IssueReturnModal.test.tsx` (+1 test, new describe block).

### Backend (`npm run test -w apps/api`, includes `--runInBand`)

```
Test Suites: 23 passed, 23 total
Tests:       95 passed, 95 total
Snapshots:   0 total
Time:        10.202 s
```

No backend files were touched by this pass (all 7 findings were frontend-only); suite is unchanged and green, confirming no regression.

### Typecheck

- `apps/web`: `npx tsc --noEmit` — clean, no errors.
- `apps/api`: `npx tsc --noEmit` — clean, no errors.

## Commits

See git log — split into logical commits (as-of snapshot leak fix + error handling, enum label maps, button contrast fix, amber→blue decoration fix, toast tests + unmount cleanup). No Claude/Anthropic co-author trailer added, per repo convention.
