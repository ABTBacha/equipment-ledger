/**
 * Retry a transaction-executing function that may throw a MongoDB `TransientTransactionError`
 * (e.g. a write conflict between two concurrent transactions touching the same document).
 * Each attempt is expected to start a fresh session/transaction internally (the caller's `fn`
 * typically calls `connection.startSession()` and `session.withTransaction(...)` itself), so a
 * retry here re-runs the whole operation from scratch against fresh state rather than resuming
 * a half-finished attempt.
 */
export async function withRetries<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (err?.hasErrorLabel?.('TransientTransactionError') && i < attempts - 1) continue;
      throw err;
    }
  }
  throw lastErr;
}
