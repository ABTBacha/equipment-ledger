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
