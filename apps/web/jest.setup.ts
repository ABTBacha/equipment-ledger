// jsdom's built-in `crypto` object doesn't implement `randomUUID` (unlike browsers
// and Node's own global crypto), so polyfill it for tests that rely on
// `crypto.randomUUID()` (e.g. `newIdempotencyKey` in `src/lib/api.ts`).
import { webcrypto } from 'crypto';

if (typeof globalThis.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
