import { ApplicationError, type InputOf } from '@tortoise/contracts';
import type { AuthorizationPort, HandlerContext, HandlerContribution } from '@tortoise/runtime';
import {
  credentialDigest as digestOf,
  newEnrollmentCode,
  normalizeCode,
} from '@tortoise/host/enrollment';
import { peerLinkModule, peerLinkOperations as ops } from '../contracts';
import {
  mappingKey,
  newId,
  type PeerLinkState,
  type PeerRecord,
  type SubjectMappingRecord,
} from '../state';
import { serviceOf, type PeerLinkServices } from '../service';

type Context = HandlerContext<PeerLinkState, PeerLinkServices>;

export const enrollmentLifetimeMs = 10 * 60_000;
/** Used or expired enrollments are kept this long for the list, then dropped. */
const enrollmentRetentionMs = 24 * 3_600_000;

export const publicPeer = ({ tokenDigest: _, publicKey: __, ...peer }: PeerRecord) => peer;

function peerOf(state: PeerLinkState, id: string) {
  const peer = Object.hasOwn(state.peers, id) ? state.peers[id] : undefined;
  if (!peer) throw new ApplicationError('NOT_FOUND', 'Peer not found');
  return peer;
}

/** Operations a list may name: every one must be in `allowed`. */
function checkOperations(
  operations: readonly string[] | undefined,
  allowed: ReadonlySet<string>,
  what: string,
) {
  const outside = (operations ?? []).filter((operation) => !allowed.has(operation));
  if (outside.length)
    throw new ApplicationError('INVALID_INPUT', `Not ${what}: ${outside.join(', ')}`);
}

function createEnrollment(input: InputOf<typeof ops.enrollmentCreate>, ctx: Context) {
  const { now, serviceOperations } = serviceOf(ctx);
  checkOperations(input.operations, serviceOperations, 'service operations of the peer API');
  const at = now();
  for (const [id, old] of Object.entries(ctx.state.enrollments))
    if (Math.max(old.expiresAt, old.redeemedAt ?? 0) + enrollmentRetentionMs < at) {
      delete ctx.state.enrollments[id];
      ctx.change(`peer-enrollment:${id}`, 'peer-enrollment.dropped');
    }
  const code = newEnrollmentCode();
  const id = newId('e');
  ctx.state.enrollments[id] = {
    id,
    label: input.label,
    subjects: input.subjects ?? 'mapped',
    createdBy: ctx.context.principalId,
    createdAt: at,
    expiresAt: at + enrollmentLifetimeMs,
    codeDigest: digestOf(code),
    ...(input.operations ? { operations: [...input.operations] } : {}),
  };
  ctx.change(`peer-enrollment:${id}`, 'peer-enrollment.created');
  // The code is returned once; the state keeps only its digest.
  return { enrollmentId: id, code, expiresAt: at + enrollmentLifetimeMs };
}

function redeem(input: InputOf<typeof ops.enrollmentRedeem>, ctx: Context) {
  const { now, application } = serviceOf(ctx);
  const at = now();
  const codeDigest = digestOf(normalizeCode(input.code));
  const enrollment = Object.values(ctx.state.enrollments).find(
    (candidate) => candidate.codeDigest === codeDigest,
  );
  // One message for every failure, so a caller cannot tell a used code from a wrong one.
  if (!enrollment || enrollment.redeemedAt !== undefined || enrollment.expiresAt <= at)
    throw new ApplicationError('FORBIDDEN', 'Enrollment code is invalid, expired or already used');
  if (Object.values(ctx.state.peers).some((peer) => peer.tokenDigest === input.tokenDigest))
    throw new ApplicationError('CONFLICT', 'Credential already issued');
  const id = newId('p');
  const peer: PeerRecord = {
    id,
    label: enrollment.label,
    application: input.application,
    ...(input.contract ? { contract: { ...input.contract } } : {}),
    publicKey: input.publicKey,
    // Unique per enrollment, so an assertion signed for one callee is refused by every other.
    audience: `${application}#${id}`,
    subjects: enrollment.subjects,
    ...(enrollment.operations ? { operations: [...enrollment.operations] } : {}),
    enrolledBy: enrollment.createdBy,
    enrolledAt: at,
    tokenDigest: input.tokenDigest,
  };
  ctx.state.peers[id] = peer;
  enrollment.redeemedAt = at;
  enrollment.peerId = id;
  ctx.change(`peer:${id}`, 'peer.enrolled');
  ctx.change(`peer-enrollment:${enrollment.id}`, 'peer-enrollment.redeemed');
  return { peer: publicPeer(peer) };
}

function map(input: InputOf<typeof ops.subjectMap>, ctx: Context) {
  const { now, onBehalfOfOperations, reserved } = serviceOf(ctx);
  const peer = peerOf(ctx.state, input.peerId);
  if (peer.revokedAt !== undefined)
    throw new ApplicationError('CONFLICT', 'The peer is revoked; enroll it again');
  if (reserved(input.principalId))
    throw new ApplicationError(
      'INVALID_INPUT',
      `${input.principalId} is a service principal; map a person`,
    );
  checkOperations(
    input.operations,
    onBehalfOfOperations,
    'on-behalf-of operations of the peer API',
  );
  const mapping: SubjectMappingRecord = {
    peerId: peer.id,
    subject: input.subject,
    principalId: input.principalId,
    ...(input.operations ? { operations: [...input.operations] } : {}),
    mappedBy: ctx.context.principalId,
    mappedAt: now(),
  };
  ctx.state.subjects[mappingKey(peer.id, input.subject)] = mapping;
  ctx.change(`peer:${peer.id}`, 'peer.subject.mapped');
  return { mapping };
}

/** The active peer of a credential digest, and the person a subject maps to, if any. */
function resolve(input: InputOf<typeof ops.credentialResolve>, ctx: Context) {
  const { reserved, now } = serviceOf(ctx);
  const peer = Object.values(ctx.state.peers).find(
    (candidate) => candidate.tokenDigest === input.tokenDigest && candidate.revokedAt === undefined,
  );
  if (!peer) return { peer: null, mapping: null };
  const { tokenDigest: _, ...resolved } = peer;
  if (input.subject === undefined) return { peer: resolved, mapping: null };
  const key = mappingKey(peer.id, input.subject);
  const mapped = Object.hasOwn(ctx.state.subjects, key) ? ctx.state.subjects[key] : undefined;
  const mapping: SubjectMappingRecord | undefined =
    mapped ??
    (peer.subjects === 'same'
      ? {
          peerId: peer.id,
          subject: input.subject,
          principalId: input.subject,
          mappedBy: peer.enrolledBy,
          mappedAt: now(),
        }
      : undefined);
  // Checked again here: a principal reserved after it was mapped, or a same-named subject.
  return {
    peer: resolved,
    mapping: mapping && !reserved(mapping.principalId) ? mapping : null,
  };
}

export const peerLinkHandlers: HandlerContribution<PeerLinkState, PeerLinkServices>[] = [
  {
    capability: ops.enrollmentCreate,
    handle: async (input, ctx) => createEnrollment(input as never, ctx),
  },
  { capability: ops.enrollmentRedeem, handle: async (input, ctx) => redeem(input as never, ctx) },
  {
    capability: ops.list,
    handle: async (_input, ctx) => ({
      peers: Object.values(ctx.state.peers)
        .sort((a, b) => a.enrolledAt - b.enrolledAt)
        .map(publicPeer),
      enrollments: Object.values(ctx.state.enrollments)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ codeDigest: _, operations: __, createdBy: ___, ...enrollment }) => enrollment),
    }),
  },
  {
    capability: ops.revoke,
    handle: async (input, ctx) => {
      const peer = peerOf(ctx.state, (input as { peerId: string }).peerId);
      if (peer.revokedAt === undefined) {
        peer.revokedAt = serviceOf(ctx).now();
        ctx.change(`peer:${peer.id}`, 'peer.revoked');
      }
      return { peer: publicPeer(peer) };
    },
  },
  { capability: ops.subjectMap, handle: async (input, ctx) => map(input as never, ctx) },
  {
    capability: ops.subjectUnmap,
    handle: async (input, ctx) => {
      const { peerId, subject } = input as { peerId: string; subject: string };
      const key = mappingKey(peerOf(ctx.state, peerId).id, subject);
      const removed = Object.hasOwn(ctx.state.subjects, key);
      if (removed) {
        delete ctx.state.subjects[key];
        ctx.change(`peer:${peerId}`, 'peer.subject.unmapped');
      }
      return { removed };
    },
  },
  {
    capability: ops.subjectList,
    handle: async (input, ctx) => {
      const { peerId } = input as { peerId?: string };
      return {
        mappings: Object.values(ctx.state.subjects)
          .filter((mapping) => peerId === undefined || mapping.peerId === peerId)
          .sort((a, b) => a.mappedAt - b.mappedAt),
      };
    },
  },
  {
    capability: ops.credentialResolve,
    handle: async (input, ctx) => resolve(input as never, ctx),
  },
];

const known = new Set<string>(peerLinkModule.capabilities.map((capability) => capability.id));

/**
 * Only admins (the local owner, or a caller acting for them under a grant that lists the
 * operation) manage peers. The enrollment route and credential lookups run as the owner narrowed
 * to exactly those two operations. Peer and enrollment events are visible to admins.
 */
export const peerLinkPolicy: AuthorizationPort<PeerLinkState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    return { allowed: state.admins.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ context, state }) => state.admins.includes(context.principalId),
};
