import { RESERVATION_STATUS_LABEL, ReservationStatus } from '../lib/types';

/**
 * Same dot-and-label idiom as StatusIndicator uses for assets, so a status reads the same
 * way wherever it appears. Colour carries meaning only alongside the label, never alone.
 *
 * ACTIVE is blue rather than green: it is a claim on the future, not a settled good state.
 * FULFILLED is the green one — the booking did what it was for. EXPIRED is amber (nobody
 * collected) and CANCELLED red (called off deliberately).
 */
const STATUS_COLOR: Record<ReservationStatus, string> = {
  ACTIVE: 'var(--accent-blue)',
  FULFILLED: 'var(--accent-green)',
  EXPIRED: 'var(--accent-amber)',
  CANCELLED: 'var(--accent-red)',
};

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span
        aria-hidden="true"
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLOR[status] }}
      />
      <span>{RESERVATION_STATUS_LABEL[status]}</span>
    </span>
  );
}
