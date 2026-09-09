'use client';

import { useState } from 'react';
import { apiFetch, newIdempotencyKey } from '../lib/api';

export function CorrectMovementForm({ movementId, onDone }: { movementId: string; onDone: () => void }) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [occurredAt, setOccurredAt] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/movements/${movementId}/correct`, {
        method: 'POST',
        body: JSON.stringify({
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          reason: reason || undefined,
          idempotencyKey,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-t pt-3">
      <label className="block text-sm mb-1">Corrected time</label>
      <input
        type="datetime-local"
        value={occurredAt}
        onChange={(e) => setOccurredAt(e.target.value)}
        className="border rounded px-2 py-1 mb-2 w-full"
        disabled={submitting}
      />
      <label className="block text-sm mb-1">Reason</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border rounded px-2 py-1 mb-2 w-full"
        disabled={submitting}
      />
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || !occurredAt}
        className="text-sm px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
      >
        Save correction
      </button>
    </div>
  );
}
