import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type DeviceKind = 'field-sync' | 'attached';

/** A paired device. Only the digest of its credential is kept; the credential went to the device. */
export interface DeviceRecord {
  id: string;
  label: string;
  kind: DeviceKind;
  enrolledBy: string;
  enrolledAt: number;
  revokedAt?: number;
  tokenDigest: string;
  /** An attached device's operations; absent means every operation of the enrolling person. */
  operations?: string[];
}

/** A pending or used pairing. Only the digest of the code is kept. */
export interface EnrollmentRecord {
  id: string;
  label: string;
  kind: DeviceKind;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  codeDigest: string;
  operations?: string[];
  redeemedAt?: number;
  deviceId?: string;
}

/** The hub side's slice, under `state['device-link']`. */
export interface DeviceLinkState {
  /** Principals who enroll, list, rename and revoke devices: the local owner. */
  admins: string[];
  devices: Record<string, DeviceRecord>;
  enrollments: Record<string, EnrollmentRecord>;
}

export const createDeviceLinkState = (ownerId: string): DeviceLinkState => ({
  admins: [ownerId],
  devices: {},
  enrollments: {},
});

/** Hex SHA-256 of text: how codes and credentials are stored and looked up. */
export const digestOf = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

/** Unambiguous upper-case letters and digits, so a code can be read aloud or typed. */
const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Ten characters from 31 (about 49 bits); the enrollment route limits failed attempts. */
export function newEnrollmentCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((byte) => codeAlphabet[byte % codeAlphabet.length]).join('');
}

/** How a person may type a code: case and separators do not matter. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A random identifier with a readable prefix, such as `d-3f9a1c0e2b7d`. */
export const newId = (prefix: string) =>
  `${prefix}-${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;

/** A device credential: 32 random bytes, base64url, matching the HTTP adapter's bearer pattern. */
export function newDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
