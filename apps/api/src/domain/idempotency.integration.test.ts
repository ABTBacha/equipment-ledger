import mongoose, { Schema } from 'mongoose';
import { withIdempotency } from './idempotency';

describe('withIdempotency', () => {
  let conn: mongoose.Connection;
  let TestModel: mongoose.Model<any>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    const schema = new Schema({ idempotencyKey: { type: String, unique: true }, value: String });
    TestModel = conn.model('IdempotencyTestDoc', schema);
  });

  afterAll(async () => {
    await TestModel.deleteMany({});
    await conn.close();
  });

  it('executes normally when the key is new', async () => {
    const { replayed, result } = await withIdempotency(TestModel, 'key-1', async () => {
      const [doc] = await TestModel.create([{ idempotencyKey: 'key-1', value: 'first' }]);
      return doc.toObject();
    });
    expect(replayed).toBe(false);
    expect(result.value).toBe('first');
  });

  it('replays the existing document on a pre-check hit instead of re-executing', async () => {
    const execute = jest.fn<Promise<any>, []>();
    const { replayed, result } = await withIdempotency(TestModel, 'key-1', execute);
    expect(replayed).toBe(true);
    expect(result.value).toBe('first');
    expect(execute).not.toHaveBeenCalled();
  });

  it('replays the existing document when a duplicate-key error happens mid-execute', async () => {
    await TestModel.create({ idempotencyKey: 'key-2', value: 'race-winner' });
    const { replayed, result } = await withIdempotency(TestModel, 'key-2', async () => {
      // Simulates a concurrent request that already inserted 'key-2' by the time this one tries.
      const [doc] = await TestModel.create([{ idempotencyKey: 'key-2', value: 'race-loser' }]);
      return doc.toObject();
    });
    expect(replayed).toBe(true);
    expect(result.value).toBe('race-winner');
  });

  it('propagates non-duplicate-key errors', async () => {
    await expect(
      withIdempotency(TestModel, 'key-3', async () => {
        throw new Error('some other failure');
      }),
    ).rejects.toThrow('some other failure');
  });
});
