import { randomBytes } from 'node:crypto';

export type SubjectMode = 'mapped' | 'same';

/**
 * An application that may call this one. Only the digest of its credential is kept; the
 * credential went to the peer. Its public key verifies the subject assertions it signs.
 */
export interface PeerRecord {
  id: string;
  label: string;
  application: string;
  contract?: { id: string; contractVersion: string; digest: string };
  publicKey: string;
  audience: string;
  subjects: SubjectMode;
  operations?: string[];
  enrolledBy: string;
  enrolledAt: number;
  revokedAt?: number;
  tokenDigest: string;
}

/** A pending or used enrollment. Only the digest of the code is kept. */
export interface PeerEnrollmentRecord {
  id: string;
  label: string;
  subjects: SubjectMode;
  operations?: string[];
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  codeDigest: string;
  redeemedAt?: number;
  peerId?: string;
}

/** A peer's subject and the person here it stands for. */
export interface SubjectMappingRecord {
  peerId: string;
  subject: string;
  principalId: string;
  operations?: string[];
  mappedBy: string;
  mappedAt: number;
}

/** A connection to a peer target. Its credential and key are in the secret store, not here. */
export interface ConnectionRecord {
  target: string;
  peerId: string;
  audience: string;
  contract: { id: string; contractVersion: string; digest: string };
  connectedBy: string;
  connectedAt: number;
}

/** The plugin's slice, under `state['peer-link']`. */
export interface PeerLinkState {
  /** Principals who enroll, map, list and revoke peers: the local owner. */
  admins: string[];
  peers: Record<string, PeerRecord>;
  enrollments: Record<string, PeerEnrollmentRecord>;
  /** By `mappingKey(peerId, subject)`. */
  subjects: Record<string, SubjectMappingRecord>;
  /** Outbound: by target. */
  connections: Record<string, ConnectionRecord>;
}

export const createPeerLinkState = (ownerId: string): PeerLinkState => ({
  admins: [ownerId],
  peers: {},
  enrollments: {},
  subjects: {},
  connections: {},
});

export const mappingKey = (peerId: string, subject: string) =>
  `${peerId}/${encodeURIComponent(subject)}`;

/** A random identifier with a readable prefix, such as `p-3f9a1c0e2b7d`. */
export const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex')}`;
