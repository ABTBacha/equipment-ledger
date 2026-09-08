import { Model } from 'mongoose';

export interface IdempotentOutcome<T> {
  replayed: boolean;
  result: T;
}

export async function withIdempotency<T>(
  model: Model<any>,
  idempotencyKey: string,
  execute: () => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  const existing = await model.findOne({ idempotencyKey }).lean();
  if (existing) {
    return { replayed: true, result: existing as T };
  }

  try {
    const result = await execute();
    return { replayed: false, result };
  } catch (err: any) {
    if (err?.code === 11000) {
      const existingAfterRace = await model.findOne({ idempotencyKey }).lean();
      if (existingAfterRace) {
        return { replayed: true, result: existingAfterRace as T };
      }
    }
    throw err;
  }
}

/**
 * Look up a document carrying this exact idempotencyKey, without throwing. Used by guards
 * that are about to reject on a "conflicting" state read — that state may have been caused
 * by our own request's earlier winner (a concurrent duplicate submission) rather than a
 * genuine business-rule violation. Deliberately NOT scoped to any particular session: the
 * read that triggered the guard may have been served from a snapshot that predates the
 * winner's commit, so a session-scoped read here could still see nothing even though the
 * winner has already committed.
 */
export async function findReplayIfExists<T>(model: Model<any>, idempotencyKey: string): Promise<T | null> {
  const existing = await model.findOne({ idempotencyKey }).lean();
  return existing as T | null;
}

/**
 * Replay the existing document for this idempotencyKey if one exists, otherwise throw the
 * given error. See `findReplayIfExists` for why the lookup must not be session-scoped.
 */
export async function replayOrThrow<T>(
  model: Model<any>,
  idempotencyKey: string,
  makeError: () => Error,
): Promise<T> {
  const existing = await findReplayIfExists<T>(model, idempotencyKey);
  if (existing) return existing;
  throw makeError();
}
