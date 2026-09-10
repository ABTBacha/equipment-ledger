'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { ReservationView } from '../lib/types';
import { DataTable, DataTableColumn } from './DataTable';
import { ReservationStatusBadge } from './ReservationStatusBadge';
import { useToast } from './ToastProvider';

/**
 * Cancelling is a soft transition on the server: the row stays, with status CANCELLED and
 * its reason, so the table keeps showing what was booked and then called off. Only ACTIVE
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
  const [cancelling, setCancelling] = useState<ReservationView | null>(null);

  // Soonest window first: the next thing the keeper has to hand over matters more than the
  // order the API happened to return, and a settled booking's place in the list is history.
  const ordered = useMemo(
    () => [...reservations].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [reservations],
  );

  const columns: DataTableColumn<ReservationView>[] = [
    ...(showAsset
      ? [
          {
            key: 'asset',
            header: 'Asset',
            render: (r: ReservationView) => <span className="font-mono">{r.assetId}</span>,
          },
        ]
      : []),
    { key: 'worker', header: 'Worker', render: (r: ReservationView) => r.workerId },
    {
      key: 'from',
      header: 'From',
      render: (r: ReservationView) => <span className="font-mono text-muted">{formatDateTime(r.startAt)}</span>,
    },
    {
      key: 'to',
      header: 'To',
      render: (r: ReservationView) => <span className="font-mono text-muted">{formatDateTime(r.endAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: ReservationView) => (
        <div>
          <ReservationStatusBadge status={r.status} />
          {r.cancelReason && <div className="text-muted mt-1">Cancelled: {r.cancelReason}</div>}
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={ordered}
        rowKey={(r) => r._id}
        emptyMessage={emptyMessage}
        actions={(r) =>
          r.status === 'ACTIVE' ? (
            <button
              type="button"
              onClick={() => setCancelling(r)}
              className="px-2 py-1 border border-hairline text-primary hover:bg-raised whitespace-nowrap"
            >
              Cancel reservation
            </button>
          ) : null
        }
      />
      {cancelling && (
        <CancelReservationDialog
          reservation={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

/**
 * The confirmation step, kept as a dialog rather than an expanding row so the table stays
 * uniform, and so the booking being called off is named in front of the keeper — a row
 * highlight is easy to lose track of once the reason field has focus.
 */
function CancelReservationDialog({
  reservation,
  onClose,
  onCancelled,
}: {
  reservation: ReservationView;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/reservations/${reservation._id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || undefined }),
      });
      showToast('Reservation cancelled');
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-raised border border-hairline p-6 w-full max-w-sm">
        <h2 className="text-lg font-semibold mb-1 text-primary">Cancel reservation</h2>
        <p className="text-sm text-muted mb-4">
          <span className="font-mono text-primary">{reservation.assetId}</span> for {reservation.workerId},{' '}
          {formatDateTime(reservation.startAt)} – {formatDateTime(reservation.endAt)}
        </p>
        <label className="block text-sm mb-1 text-muted" htmlFor={`cancel-reason-${reservation._id}`}>
          Reason (optional)
        </label>
        <input
          id={`cancel-reason-${reservation._id}`}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          className="border border-hairline bg-surface px-3 py-2 mb-3 w-full text-primary"
        />
        {error && <div className="text-sm text-accent-red mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 border border-hairline text-primary hover:bg-surface"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={submitting}
            className="px-3 py-1 border border-hairline bg-accent-red text-base disabled:opacity-50"
          >
            Confirm cancellation
          </button>
        </div>
      </div>
    </div>
  );
}
