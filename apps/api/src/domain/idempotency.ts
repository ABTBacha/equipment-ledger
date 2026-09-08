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
