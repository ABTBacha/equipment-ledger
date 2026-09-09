'use client';

import { useState } from 'react';
import { apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';

export function OutOfServiceControl({
  assetId,
  status,
  onDone,
}: {
  assetId: string;
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  onDone: () => void;
}) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'OUT_OF_SERVICE') {
    const bringBack = async () => {
      setSubmitting(true);
      setError(null);
      try {
        await apiFetch(`/assets/${assetId}/back-in-service`, {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey, loggedBy: getCurrentKeeper() ?? undefined }),
        });
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setSubmitting(false);
      }
    };

    return (
      <div>
        <button type="button" onClick={bringBack} disabled={submitting} className="px-3 py-1 border rounded disabled:opacity-50">
          Bring back into service
        </button>
        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
      </div>
    );
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="px-3 py-1 border rounded">
        Take out of service
      </button>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/assets/${assetId}/out-of-service`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          reason: reason || undefined,
          loggedBy: getCurrentKeeper() ?? undefined,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="border rounded-lg p-3">
      <label className="block text-sm mb-1">Reason (optional)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border rounded px-2 py-1 mb-2 w-full"
        disabled={submitting}
      />
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setConfirming(false)} disabled={submitting} className="px-3 py-1 border rounded">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="px-3 py-1 border rounded bg-red-600 text-white disabled:opacity-50"
        >
          Confirm take out of service
        </button>
      </div>
    </div>
  );
}
