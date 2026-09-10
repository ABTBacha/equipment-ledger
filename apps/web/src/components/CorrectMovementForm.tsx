'use client';

import { useState } from 'react';
import { apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';
import { useToast } from './ToastProvider';

export function CorrectMovementForm({
  movementId,
  canCorrectDueAt = false,
  onDone,
}: {
  movementId: string;
  /** Only an ISSUE has a due-back time to correct. */
  canCorrectDueAt?: boolean;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [occurredAt, setOccurredAt] = useState('');
  const [dueAt, setDueAt] = useState('');
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
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          reason: reason || undefined,
          idempotencyKey,
          loggedBy: getCurrentKeeper() ?? undefined,
        }),
      });
      showToast('Correction saved');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <label className="block text-sm mb-1 text-muted" htmlFor={`corrected-time-${movementId}`}>
        Corrected time
      </label>
      <input
        id={`corrected-time-${movementId}`}
        type="datetime-local"
        value={occurredAt}
        onChange={(e) => setOccurredAt(e.target.value)}
        className="border border-hairline bg-raised px-2 py-1 mb-2 w-full text-primary"
        disabled={submitting}
      />
      {canCorrectDueAt && (
        <>
          <label className="block text-sm mb-1 text-muted" htmlFor={`corrected-due-${movementId}`}>
            Corrected due back
          </label>
          <input
            id={`corrected-due-${movementId}`}
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="border border-hairline bg-raised px-2 py-1 mb-2 w-full text-primary"
            disabled={submitting}
          />
        </>
      )}
      <label className="block text-sm mb-1 text-muted">Reason</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border border-hairline bg-raised px-2 py-1 mb-2 w-full text-primary"
        disabled={submitting}
      />
      {error && <div className="text-sm text-accent-red mb-2">{error}</div>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || (!occurredAt && !dueAt)}
        className="text-sm px-3 py-1 border border-hairline bg-accent-blue text-base disabled:opacity-50"
      >
        Save correction
      </button>
    </div>
  );
}
