import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';

/** The callee route a peer posts its enrollment code to; it returns the peer credential once. */
export const enrollPath = '/api/v1/peer/enroll';

/**
 * The calling application's route that connects to a peer with a code its owner read out: it
 * enrolls through the network port, keeps the credential in the secret store and records the
 * connection. A person signed in here posts `{ target, code }`.
 */
export const connectPath = '/api/v1/peer/connect';

/** The header that carries a signed subject assertion on a call on behalf of a person. */
export const subjectHeader = 'Agent-Native-Subject';

const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const label = z
  .string()
  .regex(/^\S(.*\S)?$/)
  .max(80);
const timestamp = z.number().int().min(0);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const operation = z.string().min(1).max(200);
/** The caller's own name for a person: its principal ID there. */
const subject = z.string().min(1).max(200);
const principal = z.string().min(1).max(200);
/** A raw Ed25519 public key, base64url. */
export const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const applicationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const contractSchema = z.strictObject({
  id: applicationIdSchema,
  contractVersion: z.string().max(64),
  digest: z.string().max(80),
});

/**
 * How a peer's subjects become people here: `mapped` only through the subject table; `same` also
 * as the principal of the same ID, for two applications that sign in the same workforce.
 */
export const subjectModes = ['mapped', 'same'] as const;
export const subjectModeSchema = z.enum(subjectModes);

export const peerSchema = z.strictObject({
  id,
  label,
  /** The calling application's manifest ID, as it stated at enrollment. */
  application: applicationIdSchema,
  contract: contractSchema.optional(),
  /** What the peer names in a subject assertion's `aud`. */
  audience: z.string(),
  subjects: subjectModeSchema,
  /** The service operations the peer may call; absent means every one on the API. */
  operations: z.array(operation).optional(),
  enrolledBy: z.string(),
  enrolledAt: timestamp,
  revokedAt: timestamp.optional(),
});
export const peerEnrollmentSchema = z.strictObject({
  id,
  label,
  subjects: subjectModeSchema,
  createdAt: timestamp,
  expiresAt: timestamp,
  redeemedAt: timestamp.optional(),
  peerId: id.optional(),
});
export const subjectMappingSchema = z.strictObject({
  peerId: id,
  subject,
  principalId: principal,
  /** The on-behalf-of operations this person may be called for; absent means all of them. */
  operations: z.array(operation).optional(),
  mappedBy: z.string(),
  mappedAt: timestamp,
});

export const connectionSchema = z.strictObject({
  /** The peer target this application delivers to and reads through the connection. */
  target: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  /** The peer's own ID for this application. */
  peerId: id,
  audience: z.string(),
  contract: contractSchema,
  connectedBy: z.string(),
  connectedAt: timestamp,
});

export const peerLinkOperations = {
  enrollmentCreate: defineCapability({
    id: 'peer.enrollment.create',
    kind: 'command',
    description:
      "Let another application call this one: returns a one-use enrollment code, valid for ten minutes, that the other application exchanges for its peer credential. It calls the peer API's service operations, limited to `operations` when given, and on behalf of the people its subjects map to.",
    input: jsonSchema(
      z.strictObject({
        label,
        subjects: subjectModeSchema.optional(),
        operations: z.array(operation).max(200).optional(),
      }),
    ),
    output: jsonSchema(
      z.strictObject({ enrollmentId: id, code: z.string(), expiresAt: timestamp }),
    ),
    permission: { action: 'enroll', resourceType: 'Peer' },
    ui: { binding: 'peer-enroll' },
    audit: { fields: ['label', 'subjects', 'operations'] },
  }),
  enrollmentRedeem: defineCapability({
    id: 'peer.enrollment.redeem',
    kind: 'command',
    description:
      "Exchange an enrollment code for a peer record holding the digest of a new peer credential and the peer's public key. Called only by the plugin's enrollment route, which generates the credential and never stores it.",
    input: jsonSchema(
      z.strictObject({
        code: z.string().max(64),
        tokenDigest: digest,
        application: applicationIdSchema,
        publicKey: publicKeySchema,
        contract: contractSchema.optional(),
      }),
    ),
    output: jsonSchema(z.strictObject({ peer: peerSchema })),
    permission: { action: 'redeem', resourceType: 'Peer' },
    ui: {
      exception:
        'Called by the enrollment route on behalf of an application presenting its code; people start enrollment with peer.enrollment.create.',
    },
    audit: { fields: ['application'] },
  }),
  list: defineCapability({
    id: 'peer.list',
    kind: 'query',
    description:
      'List enrolled and revoked peers and open enrollments, without codes or credentials.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({ peers: z.array(peerSchema), enrollments: z.array(peerEnrollmentSchema) }),
    ),
    permission: { action: 'read', resourceType: 'Peer' },
    ui: { binding: 'peer-list' },
  }),
  revoke: defineCapability({
    id: 'peer.revoke',
    kind: 'command',
    description:
      'Revoke a peer: its credential stops working at its next request, for its service principal and every person it calls for. Commands it already ran stay.',
    input: jsonSchema(z.strictObject({ peerId: id })),
    output: jsonSchema(z.strictObject({ peer: peerSchema })),
    permission: { action: 'revoke', resourceType: 'Peer' },
    ui: { binding: 'peer-revoke' },
    audit: { fields: ['peerId'] },
  }),
  subjectMap: defineCapability({
    id: 'peer.subject.map',
    kind: 'command',
    description:
      "Map a peer's subject to a person here, so the peer may call the API's on-behalf-of operations as that person, limited to `operations` when given. Service and device principals cannot be mapped to.",
    input: jsonSchema(
      z.strictObject({
        peerId: id,
        subject,
        principalId: principal,
        operations: z.array(operation).max(200).optional(),
      }),
    ),
    output: jsonSchema(z.strictObject({ mapping: subjectMappingSchema })),
    permission: { action: 'map', resourceType: 'Peer' },
    ui: { binding: 'peer-subject-map' },
    audit: { fields: ['peerId', 'subject', 'principalId', 'operations'] },
  }),
  subjectUnmap: defineCapability({
    id: 'peer.subject.unmap',
    kind: 'command',
    description:
      "Remove a peer's subject mapping; the peer's next call on behalf of that subject is refused as unmapped.",
    input: jsonSchema(z.strictObject({ peerId: id, subject })),
    output: jsonSchema(z.strictObject({ removed: z.boolean() })),
    permission: { action: 'unmap', resourceType: 'Peer' },
    ui: { binding: 'peer-subject-unmap' },
    audit: { fields: ['peerId', 'subject'] },
  }),
  subjectList: defineCapability({
    id: 'peer.subject.list',
    kind: 'query',
    description: 'List subject mappings, of one peer when `peerId` is given.',
    input: jsonSchema(z.strictObject({ peerId: id.optional() })),
    output: jsonSchema(z.strictObject({ mappings: z.array(subjectMappingSchema) })),
    permission: { action: 'read', resourceType: 'Peer' },
    ui: { binding: 'peer-subject-list' },
  }),
  connectionRecord: defineCapability({
    id: 'peer.connection.record',
    kind: 'command',
    description:
      "Record a connection to a peer after enrolling with it, replacing any earlier one for the target. Called only by the plugin's connect route, as the person who connected, once the credential is in the secret store.",
    input: jsonSchema(connectionSchema.omit({ connectedBy: true, connectedAt: true })),
    output: jsonSchema(z.strictObject({ connection: connectionSchema })),
    permission: { action: 'connect', resourceType: 'Peer' },
    ui: {
      exception:
        'Recorded by the connect route the peers screen posts to, which must first enroll over the network; the record alone connects nothing.',
    },
    audit: { fields: ['target', 'peerId'] },
  }),
  connectionList: defineCapability({
    id: 'peer.connection.list',
    kind: 'query',
    description:
      'List the peer targets this application calls and their connections, without credentials or keys.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({
        targets: z.array(
          z.strictObject({
            target: z.string(),
            application: z.string(),
            connection: connectionSchema.nullable(),
          }),
        ),
      }),
    ),
    permission: { action: 'read', resourceType: 'Peer' },
    ui: { binding: 'peer-connection-list' },
  }),
  connectionRemove: defineCapability({
    id: 'peer.connection.remove',
    kind: 'command',
    description:
      'Remove the connection to a peer target: its next call fails as not connected, effects for it stay pending, and the plugin deletes the credential. The peer still lists this application until its owner revokes it.',
    input: jsonSchema(z.strictObject({ target: z.string() })),
    output: jsonSchema(z.strictObject({ removed: z.boolean() })),
    permission: { action: 'disconnect', resourceType: 'Peer' },
    ui: { binding: 'peer-connection-remove' },
    audit: { fields: ['target'] },
  }),
  credentialResolve: defineCapability({
    id: 'peer.credential.resolve',
    kind: 'query',
    description:
      'Find the active peer a credential digest belongs to, with its public key and, for `subject`, the mapping. Called only by the plugin when a request presents a peer credential.',
    input: jsonSchema(z.strictObject({ tokenDigest: digest, subject: subject.optional() })),
    output: jsonSchema(
      z.strictObject({
        peer: peerSchema.extend({ publicKey: publicKeySchema }).nullable(),
        mapping: subjectMappingSchema.nullable(),
      }),
    ),
    permission: { action: 'resolve', resourceType: 'Peer' },
    ui: {
      exception:
        'Called by the host for every request that presents a bearer credential; people see peers through peer.list.',
    },
  }),
} as const;

/** Browser-safe module of the peer link: enrollment, peers, subject mappings and lookups. */
export const peerLinkModule = defineModule({
  id: 'peer-link',
  capabilities: Object.values(peerLinkOperations),
});
