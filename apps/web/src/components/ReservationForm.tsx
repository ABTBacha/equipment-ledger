'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch, newIdempotencyKey } from '../lib/api';
import { formatConflictMessage } from '../lib/format';
import { AssetSummary } from './StoreGrid';
import { WorkerSummaryView } from '../lib/types';
import { SearchableSelect, SearchableSelectOption } from './SearchableSelect';
import { useToast } from './ToastProvider';

const ASSET_STATUS_LABEL: Record<AssetSummary['status'], string> = {
  IN_STORE: 'in store',
  ISSUED: 'issued',
  OUT_OF_SERVICE: 'out of service',
};

export function ReservationForm({ onCreated }: { onCreated: () => void }) {
  const { showToast } = useToast();
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [assetId, setAssetId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [assetOptions, setAssetOptions] = useState<SearchableSelectOption[]>([]);
  const [workerOptions, setWorkerOptions] = useState<SearchableSelectOption[]>([]);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AssetSummary[]>('/assets')
      .then((assets) => {
        if (cancelled) return;
        setAssetOptions(
          assets.map((a) => ({ value: a._id, label: `${a._id} — ${a.kind} (${ASSET_STATUS_LABEL[a.status]})` })),
        );
      })
      .catch(() => {
        // Non-fatal: the dropdown just stays empty if the asset list fails to load.
      });
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
    setError(null);
    if (!startAt || !endAt) {
      setError('Start and end are required');
      return;
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      setError('End must be after start');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/reservations', {
        method: 'POST',
        body: JSON.stringify({
          assetId,
          workerId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          idempotencyKey,
        }),
      });
      showToast('Reservation created');
      setAssetId('');
      setWorkerId('');
      setStartAt('');
      setEndAt('');
      setIdempotencyKey(newIdempotencyKey());
      onCreated();
    } catch (err) {
      // An overlap conflict names the clashing window; the server can only express it in UTC,
      // so re-render it here in the keeper's own timezone.
      const localised = err instanceof ApiError ? formatConflictMessage(err.body) : null;
      setError(localised ?? (err instanceof Error ? err.message : 'Something went wrong'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-hairline bg-surface p-4 mb-6">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <SearchableSelect
          options={assetOptions}
          value={assetId}
          onChange={setAssetId}
          placeholder="Select asset"
          disabled={submitting}
          aria-label="Asset"
        />
        <SearchableSelect
          options={workerOptions}
          value={workerId}
          onChange={setWorkerId}
          placeholder="Select worker"
          disabled={submitting}
          aria-label="Worker"
        />
        <input
          type="datetime-local"
          aria-label="Start"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
          className="border border-hairline bg-raised px-3 py-2 text-primary"
          disabled={submitting}
        />
        <input
          type="datetime-local"
          aria-label="End"
          value={endAt}
          onChange={(e) => setEndAt(e.target.value)}
          className="border border-hairline bg-raised px-3 py-2 text-primary"
          disabled={submitting}
        />
      </div>
      {error && <div className="text-sm text-accent-red mb-2">{error}</div>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="px-3 py-1 border border-hairline bg-accent-blue text-base disabled:opacity-50"
      >
        Reserve
      </button>
    </div>
  );
}
