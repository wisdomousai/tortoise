import { randomBytes } from 'node:crypto';

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

/** A random identifier with a readable prefix, such as `d-3f9a1c0e2b7d`. */
export const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex')}`;
