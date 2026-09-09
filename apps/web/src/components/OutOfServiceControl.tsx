'use client';

import { useState } from 'react';
import { apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';
import { useToast } from './ToastProvider';

export function OutOfServiceControl({
  assetId,
  status,
  onDone,
}: {
  assetId: string;
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Regenerate the idempotency key and reset per-attempt state after every successful
  // transition. This component is not remounted when the parent refreshes (router.refresh()
  // keeps it mounted), so without this a second transition attempt would either replay the
  // stale first request's key or find its trigger permanently disabled.
  const resetForNextAttempt = () => {
    setIdempotencyKey(newIdempotencyKey());
    setSubmitting(false);
    setConfirming(false);
    setReason('');
    setError(null);
  };

  if (status === 'OUT_OF_SERVICE') {
    const bringBack = async () => {
      setSubmitting(true);
      setError(null);
      try {
        await apiFetch(`/assets/${assetId}/back-in-service`, {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey, loggedBy: getCurrentKeeper() ?? undefined }),
        });
        showToast('Brought back into service');
        resetForNextAttempt();
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setSubmitting(false);
      }
    };

    return (
      <div>
        <button
          type="button"
          onClick={bringBack}
          disabled={submitting}
          className="px-3 py-1 border border-hairline text-primary hover:bg-raised disabled:opacity-50"
        >
          Bring back into service
        </button>
        {error && <div className="text-sm text-accent-red mt-2">{error}</div>}
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="px-3 py-1 border border-hairline text-primary hover:bg-raised"
      >
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
      showToast('Taken out of service');
      resetForNextAttempt();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-hairline bg-surface p-3">
      <label className="block text-sm mb-1 text-muted">Reason (optional)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border border-hairline bg-raised px-2 py-1 mb-2 w-full text-primary"
        disabled={submitting}
      />
      {error && <div className="text-sm text-accent-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={submitting}
          className="px-3 py-1 border border-hairline text-primary hover:bg-raised"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="px-3 py-1 border border-hairline bg-accent-red text-base disabled:opacity-50"
        >
          Confirm take out of service
        </button>
      </div>
    </div>
  );
}
