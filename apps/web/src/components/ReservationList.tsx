'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { RESERVATION_STATUS_LABEL, ReservationView } from '../lib/types';
import { useToast } from './ToastProvider';

/**
 * Cancelling is a soft transition on the server: the row stays, with status CANCELLED and its
 * reason, so the list keeps showing what was booked and then called off. Only ACTIVE
 * reservations can be cancelled — EXPIRED ones are already past, and the API refuses them.
 */
export function ReservationList({
  reservations,
  onChanged,
  emptyMessage = 'No reservations.',
  showAsset = true,
}: {
  reservations: ReservationView[];
  onChanged: () => void;
  emptyMessage?: string;
  showAsset?: boolean;
}) {
  const { showToast } = useToast();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (reservations.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  const startConfirming = (id: string) => {
    setConfirmingId(id);
    setReason('');
    setError(null);
  };

  const cancel = async (id: string) => {
    setSubmittingId(id);
    setError(null);
    try {
      await apiFetch(`/reservations/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || undefined }),
      });
      showToast('Reservation cancelled');
      setConfirmingId(null);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <ul className="space-y-2">
      {reservations.map((r) => {
        const cancellable = r.status === 'ACTIVE';
        const confirming = confirmingId === r._id;
        const submitting = submittingId === r._id;
        return (
          <li
            key={r._id}
            className={`text-sm border border-hairline bg-surface p-3 text-primary ${
              r.status === 'ACTIVE' ? '' : 'opacity-60'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                {showAsset && <span className="font-mono">{r.assetId}</span>}
                {showAsset && ' — '}
                {r.workerId}: {formatDateTime(r.startAt)} – {formatDateTime(r.endAt)} (
                {RESERVATION_STATUS_LABEL[r.status]})
                {r.cancelReason && <div className="text-muted mt-1">Cancelled: {r.cancelReason}</div>}
              </div>
              {cancellable && !confirming && (
                <button
                  type="button"
                  onClick={() => startConfirming(r._id)}
                  className="shrink-0 px-2 py-1 border border-hairline text-primary hover:bg-raised"
                >
                  Cancel reservation
                </button>
              )}
            </div>
            {confirming && (
              <div className="mt-3 border-t border-hairline pt-3">
                <label className="block text-sm mb-1 text-muted" htmlFor={`cancel-reason-${r._id}`}>
                  Reason (optional)
                </label>
                <input
                  id={`cancel-reason-${r._id}`}
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submitting}
                  className="border border-hairline bg-raised px-2 py-1 mb-2 w-full text-primary"
                />
                {error && <div className="text-sm text-accent-red mb-2">{error}</div>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={submitting}
                    className="px-3 py-1 border border-hairline text-primary hover:bg-raised"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={() => cancel(r._id)}
                    disabled={submitting}
                    className="px-3 py-1 border border-hairline bg-accent-red text-base disabled:opacity-50"
                  >
                    Confirm cancellation
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
