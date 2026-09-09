import { ApiError, apiFetch } from './api';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Conflict',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('apiFetch error handling', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('throws an ApiError carrying the status and the full response body', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      mockResponse(409, {
        message: 'Overlaps an existing reservation',
        code: 'RESERVATION_OVERLAP',
        conflict: { startAt: '2027-01-10T09:00:00.000Z', endAt: '2027-01-10T17:00:00.000Z' },
      }),
    );

    const error = await apiFetch('/reservations', { method: 'POST' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Overlaps an existing reservation');
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).body).toMatchObject({
      code: 'RESERVATION_OVERLAP',
      conflict: { startAt: '2027-01-10T09:00:00.000Z', endAt: '2027-01-10T17:00:00.000Z' },
    });
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    const error = await apiFetch('/reservations')
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Internal Server Error');
  });
});
