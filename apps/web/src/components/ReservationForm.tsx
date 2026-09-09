'use client';

import { useState } from 'react';
import { apiFetch, newIdempotencyKey } from '../lib/api';
import { useToast } from './ToastProvider';

export function ReservationForm({ onCreated }: { onCreated: () => void }) {
  const { showToast } = useToast();
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [assetId, setAssetId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-hairline bg-surface p-4 mb-6">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <input
          type="text"
          placeholder="Asset ID"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          className="border border-hairline bg-raised px-3 py-2 text-primary placeholder:text-muted"
          disabled={submitting}
        />
        <input
          type="text"
          placeholder="Worker ID"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="border border-hairline bg-raised px-3 py-2 text-primary placeholder:text-muted"
          disabled={submitting}
        />
        <input
          type="datetime-local"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
          className="border border-hairline bg-raised px-3 py-2 text-primary"
          disabled={submitting}
        />
        <input
          type="datetime-local"
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
        className="px-3 py-1 border border-hairline bg-accent-blue text-primary disabled:opacity-50"
      >
        Reserve
      </button>
    </div>
  );
}
