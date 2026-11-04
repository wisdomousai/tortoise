import { createHash, randomBytes } from 'node:crypto';
import { ApplicationError } from '@tortoise/contracts';

/**
 * Pairing by a one-use code, as the device link and the peer link use it: a person creates an
 * enrollment and reads its code to the other side, which exchanges it once for a credential.
 * The plugin stores only digests of codes and credentials.
 */

/** Hex SHA-256 of text: how codes and credentials are stored and looked up. */
export const credentialDigest = (text: string) => createHash('sha256').update(text).digest('hex');

/** Unambiguous upper-case letters and digits, so a code can be read aloud or typed. */
const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Ten characters from 31 (about 49 bits); the enrollment route limits failed attempts. */
export function newEnrollmentCode(): string {
  return [...randomBytes(10)].map((byte) => codeAlphabet[byte % codeAlphabet.length]).join('');
}

/** How a person may type a code: case and separators do not matter. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The shape `newCredential` produces; anything else is not a credential an enrollment issued. */
export const credentialPattern = /^[A-Za-z0-9_-]{43}$/;

/** A bearer credential: 32 random bytes, base64url, matching the HTTP adapter's bearer pattern. */
export const newCredential = (): string => randomBytes(32).toString('base64url');

/**
 * Failed exchanges allowed per window, for all callers together. A code has about 49 bits, so
 * at this rate guessing one within its ten minutes is out of reach; a person mistyping still
 * gets several tries.
 */
export function createAttemptLimit(now: () => number, limit = 10, windowMs = 60_000) {
  let windowStart = 0;
  let failures = 0;
  return {
    check() {
      if (now() - windowStart >= windowMs) {
        windowStart = now();
        failures = 0;
      }
      if (failures >= limit)
        throw new ApplicationError('UNAVAILABLE', 'Too many failed enrollments; try again shortly');
    },
    fail() {
      failures++;
    },
  };
}
export type AttemptLimit = ReturnType<typeof createAttemptLimit>;
