const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * A failed API call. Extends Error so every existing `err instanceof Error` handler keeps
 * working, but also carries the parsed response body — some errors (notably the reservation
 * overlap conflict) ship structured data the UI renders better than the flat `message`.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(body.message ?? `Request failed with status ${res.status}`, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const KEEPER_STORAGE_KEY = 'equipment-ledger:keeper';

/** Reads the keeper name KeeperGate persisted at login. Cosmetic attribution only — not access control. */
export function getCurrentKeeper(): string | null {
  try {
    return window.localStorage.getItem(KEEPER_STORAGE_KEY);
  } catch {
    return null;
  }
}
