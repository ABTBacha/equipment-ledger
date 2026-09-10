'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';
import { AssetSummary } from './StoreGrid';
import { SearchableSelect, SearchableSelectOption } from './SearchableSelect';
import { ReservationView, WorkerSummaryView } from '../lib/types';
import { formatConflictMessage, formatDateTime } from '../lib/format';
import { useToast } from './ToastProvider';

/** An ISO instant as the local-time string a datetime-local input understands. */
function toPickerValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function IssueReturnModal({
  asset,
  action,
  onClose,
}: {
  asset: AssetSummary;
  action: 'issue' | 'return';
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [workerId, setWorkerId] = useState('');
  const [workerOptions, setWorkerOptions] = useState<SearchableSelectOption[]>([]);
  const [occurredAt, setOccurredAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [reservations, setReservations] = useState<ReservationView[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<WorkerSummaryView[]>('/workers')
      .then((workers) => {
        if (cancelled) return;
        setWorkerOptions(workers.map((w) => ({ value: w._id, label: `${w.name} (${w._id})` })));
      })
      .catch(() => {
        // Non-fatal: the dropdown just stays empty if the worker list fails to load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (action !== 'issue') return;
    let cancelled = false;
    apiFetch<ReservationView[]>('/reservations')
      .then((all) => {
        if (cancelled) return;
        setReservations(all.filter((r) => r.assetId === asset._id));
      })
      .catch(() => {
        // Non-fatal: the API refuses a clashing issue regardless, so the worst case is
        // the keeper learns about the booking from the refusal rather than beforehand.
      });
    return () => {
      cancelled = true;
    };
  }, [action, asset._id]);

  // A booking only bears on this loan while it is live and its window has not closed;
  // a window that has passed is somebody who did not come, and does not gate anything.
  const liveReservations = useMemo(
    () => reservations.filter((r) => r.status === 'ACTIVE' && new Date(r.endAt).getTime() > Date.now()),
    [reservations],
  );
  const collecting = useMemo(
    () =>
      liveReservations.find(
        (r) => r.workerId === workerId && new Date(r.startAt).getTime() <= Date.now(),
      ) ?? null,
    [liveReservations, workerId],
  );
  const someoneElses = useMemo(
    () => (workerId ? liveReservations.find((r) => r.workerId !== workerId) ?? null : null),
    [liveReservations, workerId],
  );

  // Collecting pins the due-back time to the window: the booking already states when the
  // asset is free again, and the API refuses any other value.
  const pinnedDueAt = collecting ? toPickerValue(collecting.endAt) : null;
  const effectiveDueAt = pinnedDueAt ?? dueAt;

  const submit = async () => {
    if (action === 'issue' && effectiveDueAt) {
      const issuedAt = occurredAt ? new Date(occurredAt) : new Date();
      if (new Date(effectiveDueAt).getTime() <= issuedAt.getTime()) {
        setError('Due back must be after the time the asset went out.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const path = action === 'issue' ? '/movements/issue' : '/movements/return';
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({
          assetId: asset._id,
          workerId,
          idempotencyKey,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          // Only ever sent on an issue, and only when the keeper named a time: an asset
          // issued without one never reads as overdue, which is the honest answer when
          // nobody said when it was coming back.
          dueAt: action === 'issue' && effectiveDueAt ? new Date(effectiveDueAt).toISOString() : undefined,
          loggedBy: getCurrentKeeper() ?? undefined,
        }),
      });
      showToast(action === 'issue' ? `Issued to ${workerId}` : 'Returned');
      onClose();
    } catch (err) {
      const localised = err instanceof ApiError ? formatConflictMessage(err.body) : null;
      setError(localised ?? (err instanceof Error ? err.message : 'Something went wrong'));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-raised border border-hairline p-6 w-full max-w-sm">
        <h2 className="text-lg font-semibold mb-4 text-primary">
          {action === 'issue' ? 'Issue' : 'Return'} {asset._id}
        </h2>
        <div className="mb-3">
          <SearchableSelect
            options={workerOptions}
            value={workerId}
            onChange={setWorkerId}
            placeholder="Select worker"
            disabled={submitting}
            aria-label="Worker"
            fieldBackground="bg-surface"
          />
        </div>
        <label className="block text-sm mb-1 text-muted" htmlFor="occurred-at">
          Occurred at (leave blank for now)
        </label>
        <input
          id="occurred-at"
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="border border-hairline bg-surface px-3 py-2 w-full mb-3 text-primary"
          disabled={submitting}
        />
        {action === 'issue' && (
          <>
            {/*
              A blank "occurred at" means now, which a browser picker cannot express as a
              bound, so min only constrains the field once the keeper has named a time.
              submit() covers both cases, and so does the API.
            */}
            <label className="block text-sm mb-1 text-muted" htmlFor="due-at">
              Due back (optional)
            </label>
            <input
              id="due-at"
              type="datetime-local"
              min={occurredAt || undefined}
              value={effectiveDueAt}
              readOnly={pinnedDueAt !== null}
              onChange={(e) => setDueAt(e.target.value)}
              className={`border border-hairline px-3 py-2 w-full text-primary ${
                pinnedDueAt !== null ? 'bg-raised text-muted mb-1' : 'bg-surface mb-3'
              }`}
              disabled={submitting}
            />
            {collecting && (
              <p className="text-sm text-muted mb-3">
                Collecting a reservation, so it is due back when the window ends.
              </p>
            )}
            {someoneElses && (
              <p className="text-sm text-accent-red mb-3">
                Reserved for {someoneElses.workerId} from {formatDateTime(someoneElses.startAt)} to{' '}
                {formatDateTime(someoneElses.endAt)}.
              </p>
            )}
          </>
        )}
        {error && <div className="text-sm text-accent-red mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 border border-hairline text-primary hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !workerId}
            className="px-3 py-1 border border-hairline bg-accent-blue text-base disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
