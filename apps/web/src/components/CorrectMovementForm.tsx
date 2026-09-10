'use client';

import { useState } from 'react';
import { apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';
import { useToast } from './ToastProvider';

/** An ISO instant as the local-time string a datetime-local input understands. */
function toPickerValue(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CorrectMovementForm({
  movementId,
  canCorrectDueAt = false,
  issuedAt,
  onDone,
}: {
  movementId: string;
  /** Only an ISSUE has a due-back time to correct. */
  canCorrectDueAt?: boolean;
  /** The movement's own occurredAt, which a corrected due-back time has to stay after. */
  issuedAt?: string;
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
    const effectiveIssuedAt = occurredAt || issuedAt;
    if (dueAt && effectiveIssuedAt && new Date(dueAt).getTime() <= new Date(effectiveIssuedAt).getTime()) {
      setError('Due back must be after the time the asset went out.');
      return;
    }

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
            min={occurredAt || toPickerValue(issuedAt)}
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
