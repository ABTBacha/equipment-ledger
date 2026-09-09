'use client';

import { useState } from 'react';
import { apiFetch, getCurrentKeeper, newIdempotencyKey } from '../lib/api';
import { AssetSummary } from './StoreGrid';

export function IssueReturnModal({
  asset,
  action,
  onClose,
}: {
  asset: AssetSummary;
  action: 'issue' | 'return';
  onClose: () => void;
}) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [workerId, setWorkerId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          loggedBy: getCurrentKeeper() ?? undefined,
        }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg p-6 w-full max-w-sm">
        <h2 className="text-lg font-semibold mb-4">
          {action === 'issue' ? 'Issue' : 'Return'} {asset._id}
        </h2>
        <input
          type="text"
          placeholder="Worker ID"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="border rounded px-3 py-2 w-full mb-3"
          disabled={submitting}
        />
        <label className="block text-sm mb-1">Occurred at (leave blank for now)</label>
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="border rounded px-3 py-2 w-full mb-3"
          disabled={submitting}
        />
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="px-3 py-1 border rounded">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !workerId}
            className="px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
