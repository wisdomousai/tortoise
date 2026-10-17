/**
 * Preload for `bun run test:portable`: remove the Web globals Hermes may lack, then install the
 * kernel's replacements, so the portable suites prove they run on `installGlobals` alone.
 * `crypto.getRandomValues` stays: on React Native the platform supplies it from `expo-crypto`.
 */
import { installGlobals, missingGlobals } from '../src/globals';

const target = globalThis as Record<string, unknown>;
delete target.structuredClone;
const signal = AbortSignal as unknown as Record<string, unknown>;
delete signal.any;
delete signal.timeout;
Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });

const removed = missingGlobals();
if (removed.join() !== 'structuredClone,AbortSignal.any,AbortSignal.timeout,crypto.randomUUID')
  throw new Error(`Expected the Hermes gaps to be missing, found ${removed.join(', ')}`);
installGlobals();
const left = missingGlobals();
if (left.length) throw new Error(`installGlobals left ${left.join(', ')} missing`);
