'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';
import { AssetSummary } from './StoreGrid';
import { SearchableSelect, SearchableSelectOption } from './SearchableSelect';
import { WorkerSummaryView } from '../lib/types';
import { useToast } from './ToastProvider';

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

  const submit = async () => {
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
          dueAt: action === 'issue' && dueAt ? new Date(dueAt).toISOString() : undefined,
          loggedBy: getCurrentKeeper() ?? undefined,
        }),
      });
      showToast(action === 'issue' ? `Issued to ${workerId}` : 'Returned');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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
        <label className="block text-sm mb-1 text-muted">Occurred at (leave blank for now)</label>
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="border border-hairline bg-surface px-3 py-2 w-full mb-3 text-primary"
          disabled={submitting}
        />
        {action === 'issue' && (
          <>
            <label className="block text-sm mb-1 text-muted" htmlFor="due-at">
              Due back (optional)
            </label>
            <input
              id="due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="border border-hairline bg-surface px-3 py-2 w-full mb-3 text-primary"
              disabled={submitting}
            />
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
