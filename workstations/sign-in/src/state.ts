import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { timingSafeEqual } from 'node:crypto';

/** An enrolled badge. Only digests are kept: of the badge value, and of the PIN with its salt. */
export interface BadgeRecord {
  id: string;
  principalId: string;
  label: string;
  badgeDigest: string;
  pinSalt: string;
  pinHash: string;
  enrolledBy: string;
  enrolledAt: number;
  revokedAt?: number;
  /** Consecutive failed PINs since the last sign-in or lockout. */
  failures: number;
  lockedUntil?: number;
}

/** An operator signed in at a seat. Only the digest of its token is kept. */
export interface SessionRecord {
  id: string;
  badgeId: string;
  principalId: string;
  seatPrincipal: string;
  seat: string;
  tokenDigest: string;
  startedAt: number;
  expiresAt: number;
  endedAt?: number;
}

/** The plugin's slice, under `state['station-sign-in']`. */
export interface StationSignInState {
  /** Principals who enroll and revoke badges: the local owner. */
  admins: string[];
  badges: Record<string, BadgeRecord>;
  sessions: Record<string, SessionRecord>;
}

export const createStationSignInState = (ownerId: string): StationSignInState => ({
  admins: [ownerId],
  badges: {},
  sessions: {},
});

/** Hex SHA-256 of text: how badge values and tokens are stored and looked up. */
export const digestOf = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

/**
 * scrypt of a PIN. A PIN has few possible values, so the hash alone does not keep it secret
 * from someone who reads the workspace; the lockout is what stops guessing at a seat.
 */
const hashPin = (pin: string, salt: string) =>
  bytesToHex(scrypt(utf8ToBytes(pin), hexToBytes(salt), { N: 2 ** 14, r: 8, p: 1, dkLen: 32 }));

export function pinVerifier(pin: string) {
  const pinSalt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  return { pinSalt, pinHash: hashPin(pin, pinSalt) };
}

export function pinMatches(pin: string, verifier: { pinSalt: string; pinHash: string }) {
  return timingSafeEqual(
    Buffer.from(hashPin(pin, verifier.pinSalt), 'hex'),
    Buffer.from(verifier.pinHash, 'hex'),
  );
}

/** A random identifier with a readable prefix, such as `b-3f9a1c0e2b7d`. */
export const newId = (prefix: string) =>
  `${prefix}-${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;

/** An operator token: 32 random bytes, base64url, matching the HTTP adapter's bearer pattern. */
export const newOperatorToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
