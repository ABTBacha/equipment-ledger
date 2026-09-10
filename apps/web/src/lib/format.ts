/** Renders an instant in the viewer's own timezone. The API always speaks UTC ISO strings. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function isValidInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/**
 * The API's reservation-overlap conflict interpolates the conflicting window into `message` as
 * UTC ISO strings, which are unreadable to a store keeper. The same window also ships as
 * structured `conflict` data; rebuild the sentence from that in local time.
 *
 * Returns null when the error is anything else, so callers fall back to the server's message.
 */
export function formatOverlapMessage(body: Record<string, unknown> | undefined): string | null {
  if (!body || body.code !== 'RESERVATION_OVERLAP') return null;
  const conflict = body.conflict as { startAt?: unknown; endAt?: unknown } | undefined;
  if (!conflict || !isValidInstant(conflict.startAt) || !isValidInstant(conflict.endAt)) return null;
  return `Overlaps an existing reservation from ${formatDateTime(conflict.startAt)} to ${formatDateTime(
    conflict.endAt,
  )}`;
}

/**
 * Rewrites the API's structured refusals in the viewer's local time. Every refusal that
 * carries instants ships them as `conflict` data as well as interpolating UTC into
 * `message`, because a store keeper cannot read `2026-09-11T17:00:00.000Z`.
 *
 * Returns null for anything unrecognised, so callers fall back to the server sentence
 * rather than inventing one.
 */
export function formatConflictMessage(body: Record<string, unknown> | undefined): string | null {
  const overlap = formatOverlapMessage(body);
  if (overlap) return overlap;
  if (!body) return null;

  const conflict = body.conflict as Record<string, unknown> | undefined;
  if (!conflict) return null;

  if (body.code === 'ASSET_OUT_UNTIL' && isValidInstant(conflict.dueAt)) {
    const holder = typeof conflict.workerId === 'string' ? conflict.workerId : 'somebody';
    return `Already out with ${holder} until ${formatDateTime(conflict.dueAt)}`;
  }

  if (
    body.code === 'RESERVED_FOR_ANOTHER_WORKER' &&
    isValidInstant(conflict.startAt) &&
    isValidInstant(conflict.endAt) &&
    typeof conflict.workerId === 'string'
  ) {
    return `Reserved for ${conflict.workerId} from ${formatDateTime(conflict.startAt)} to ${formatDateTime(
      conflict.endAt,
    )}`;
  }

  return null;
}
