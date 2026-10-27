import { deserialize, serialize } from '@ungap/structured-clone';

/**
 * Web platform globals the kernel, runtime and integrations call. Bun and browsers have all of
 * them; Hermes lacks some, depending on the React Native version.
 */
const required = {
  structuredClone: () => typeof globalThis.structuredClone === 'function',
  AbortController: () => typeof globalThis.AbortController === 'function',
  'AbortSignal.any': () => typeof globalThis.AbortSignal?.any === 'function',
  'AbortSignal.timeout': () => typeof globalThis.AbortSignal?.timeout === 'function',
  'crypto.getRandomValues': () => typeof globalThis.crypto?.getRandomValues === 'function',
  'crypto.randomUUID': () => typeof globalThis.crypto?.randomUUID === 'function',
} as const;
export type RequiredGlobal = keyof typeof required;

/** The required globals this JavaScript host lacks. */
export function missingGlobals(): RequiredGlobal[] {
  return (Object.keys(required) as RequiredGlobal[]).filter((name) => !required[name]());
}

/**
 * Fail before any state opens when a required global is missing, instead of failing in the
 * middle of a transaction. A platform that lacks some installs them first with `installGlobals`.
 */
export function assertGlobals() {
  const missing = missingGlobals();
  if (missing.length)
    throw new Error(
      `This JavaScript host lacks ${missing.join(', ')}; the platform must call installGlobals first`,
    );
}

/** An `AbortError`-like reason; Hermes may have no `DOMException`. */
function abortReason(name: 'AbortError' | 'TimeoutError', message: string) {
  if (typeof DOMException === 'function') return new DOMException(message, name);
  return Object.assign(new Error(message), { name });
}

function signalTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(abortReason('TimeoutError', 'The operation timed out')), ms);
  return controller.signal;
}

function signalAny(signals: Iterable<AbortSignal>): AbortSignal {
  const controller = new AbortController();
  const list = [...signals];
  const complete = (signal: AbortSignal) => {
    for (const other of list) other.removeEventListener('abort', onAbort);
    controller.abort(signal.reason ?? abortReason('AbortError', 'The operation was aborted'));
  };
  function onAbort(this: AbortSignal) {
    complete(this);
  }
  const already = list.find((signal) => signal.aborted);
  if (already) complete(already);
  else for (const signal of list) signal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

/** RFC 9562 version 4 UUID from 16 random bytes. */
function uuidFrom(getRandomValues: (array: Uint8Array) => Uint8Array) {
  return (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** Define rather than assign, so a present but read-only placeholder is replaced too. */
const define = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { value, writable: true, configurable: true });

/**
 * Install the required globals this host lacks; present ones are never replaced. `AbortController`
 * and a cryptographically secure `getRandomValues` cannot be written in JavaScript: the platform
 * supplies the latter (on React Native, from `expo-crypto`) when `crypto.getRandomValues` is
 * absent, and a missing `AbortController` still fails `assertGlobals`. Idempotent.
 */
export function installGlobals(
  options: { readonly getRandomValues?: (array: Uint8Array) => Uint8Array } = {},
) {
  const target = globalThis as Record<string, unknown>;
  if (typeof globalThis.structuredClone !== 'function')
    // serialize/deserialize directly: the package's default export delegates to a global
    // structuredClone that existed when it loaded, which would then be this fallback.
    define(target, 'structuredClone', (value: unknown) => deserialize(serialize(value)));
  const signal = globalThis.AbortSignal as unknown as Record<string, unknown> | undefined;
  if (signal && typeof signal.timeout !== 'function') define(signal, 'timeout', signalTimeout);
  if (signal && typeof signal.any !== 'function') define(signal, 'any', signalAny);
  if (typeof target.crypto !== 'object' || target.crypto === null) define(target, 'crypto', {});
  const crypto = target.crypto as Record<string, unknown>;
  if (typeof crypto.getRandomValues !== 'function' && options.getRandomValues)
    define(crypto, 'getRandomValues', options.getRandomValues);
  if (typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues === 'function')
    define(
      crypto,
      'randomUUID',
      uuidFrom((array) => (crypto.getRandomValues as (array: Uint8Array) => Uint8Array)(array)),
    );
}
