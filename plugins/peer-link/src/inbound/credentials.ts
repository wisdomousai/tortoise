import { ApplicationError } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';
import { credentialDigest, credentialPattern } from '@tortoise/host/enrollment';
import { peerPrincipal } from '@tortoise/integration';
import {
  assertionBodyLimit,
  assertionLifetime,
  assertionSkew,
  bodyDigest,
  requestLine,
  verifySubjectAssertion,
  type SubjectClaims,
} from '../assertion';
import { peerLinkOperations as ops, subjectHeader } from '../contracts';
import type { PeerCaller } from './routes';

interface ResolvedPeer {
  readonly id: string;
  readonly publicKey: string;
  readonly audience: string;
  readonly operations?: readonly string[];
}
interface ResolvedMapping {
  readonly principalId: string;
  readonly operations?: readonly string[];
}

export interface PeerAuthenticationOptions {
  readonly now: () => number;
  readonly serviceOperations: readonly string[];
  readonly onBehalfOfOperations: readonly string[];
  /** `refuse` (the default): a call a delegated run made on the caller is refused. */
  readonly agents: 'refuse' | 'allow';
  readonly replay: ReplayCache;
}

/**
 * Refuse a subject assertion. `details.assertion` names the reason, so the caller's peer port can
 * tell an assertion to sign again (`expired`, `replayed`) from a person to map (`unmapped`) and
 * from a call that will never pass.
 */
const refuse = (reason: string, message: string): never => {
  throw new ApplicationError('FORBIDDEN', message, { assertion: reason });
};

/**
 * `jti`s seen within their lifetime, per peer. In memory: a restart forgets them, so an assertion
 * captured in the two minutes before a restart could be presented once more after it; the bearer
 * credential is still needed. Bounded: when full, assertions are refused until entries expire.
 */
export function createReplayCache(limit = 100_000) {
  const seen = new Map<string, number>();
  return {
    /** False when the `jti` was already presented by this peer. */
    claim(peerId: string, jti: string, exp: number, nowSeconds: number): boolean {
      const key = `${peerId}/${jti}`;
      if (seen.has(key)) return false;
      if (seen.size >= limit)
        for (const [entry, expires] of seen) if (expires < nowSeconds) seen.delete(entry);
      if (seen.size >= limit)
        throw new ApplicationError('UNAVAILABLE', 'Too many calls on behalf of people; try again');
      seen.set(key, exp);
      return true;
    },
  };
}
export type ReplayCache = ReturnType<typeof createReplayCache>;

/**
 * Check a subject assertion against the request it came with, in a fixed order: signature,
 * audience, request line, body digest, time, then the replay cache. The body is read from a
 * clone, so the adapter still reads the original.
 */
async function verify(
  header: string,
  request: Request,
  peer: ResolvedPeer,
  options: PeerAuthenticationOptions,
): Promise<SubjectClaims> {
  const claims = await verifySubjectAssertion(header, peer.publicKey);
  if (!claims) return refuse('signature', 'The subject assertion is not signed by this peer');
  if (claims.aud !== peer.audience)
    return refuse('audience', 'The subject assertion names another audience');
  if (claims.req !== requestLine(request.method, request.url))
    return refuse('request', 'The subject assertion was signed for another request');
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > assertionBodyLimit)
    return refuse('body', 'A call on behalf of a person carries at most 1 MiB');
  const body = new Uint8Array(await request.clone().arrayBuffer());
  if (body.byteLength > assertionBodyLimit)
    return refuse('body', 'A call on behalf of a person carries at most 1 MiB');
  if (claims.body !== (await bodyDigest(body)))
    return refuse('body', 'The subject assertion was signed for another body');
  const now = Math.floor(options.now() / 1000);
  if (
    claims.exp <= now ||
    claims.iat > now + assertionSkew ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > assertionLifetime
  )
    return refuse('expired', 'The subject assertion is expired or not yet valid');
  if (!options.replay.claim(peer.id, claims.jti, claims.exp, now))
    return refuse('replayed', 'The subject assertion was already used');
  return claims;
}

/**
 * The caller a peer credential stands for, looked up through the runtime on every request, so a
 * revocation or unmapping committed a moment ago already applies.
 *
 * - Without a subject assertion the peer acts as `peer:<id>`, with a grant listing the API's
 *   service operations, or the narrower list its enrollment named. The application's policy
 *   gives that principal its integration allowlist (`peerAllowlist`).
 * - With one, after the checks of `verify`, it acts as the person the subject maps to, with a
 *   grant of the API's on-behalf-of operations within the mapping's. That person's own policy
 *   applies; a person-only rule refuses the call, as it refuses any delegated caller. The grant
 *   has no expiry, so the receipt fingerprint of a redelivered effect stays the same.
 *
 * A bearer this plugin did not issue is not its business: it returns undefined and the next
 * plugin is asked.
 */
export async function authenticatePeer(
  token: string,
  request: Request | undefined,
  caller: PeerCaller | undefined,
  options: PeerAuthenticationOptions,
): Promise<ExecutionContext | undefined> {
  if (!caller || !credentialPattern.test(token)) return undefined;
  const header = request?.headers.get(subjectHeader) ?? undefined;
  // The subject is read before the signature is checked only to fetch its mapping in the same
  // query; nothing is decided on it until `verify` has passed.
  const unverified = header ? unverifiedSubject(header) : undefined;
  const result = await caller.application.queryRaw(
    {
      operation: ops.credentialResolve.id,
      input: {
        tokenDigest: credentialDigest(token),
        ...(unverified === undefined ? {} : { subject: unverified }),
      },
    },
    caller.context,
  );
  const { peer, mapping } = result.data as {
    peer: ResolvedPeer | null;
    mapping: ResolvedMapping | null;
  };
  if (!peer) return undefined;
  const { workspaceId } = caller;
  if (!header || !request) {
    const principalId = peerPrincipal(peer.id);
    const operations = peer.operations
      ? options.serviceOperations.filter((operation) => peer.operations!.includes(operation))
      : options.serviceOperations;
    return {
      workspaceId,
      principalId,
      grant: { operations: [...operations], principalId, workspaceId },
      peer: { id: peer.id },
    };
  }
  const claims = await verify(header, request, peer, options);
  if (claims.act === 'agent' && options.agents === 'refuse')
    return refuse('agent', 'This application takes calls on behalf of people only from people');
  if (!mapping || claims.sub !== unverified)
    return refuse('unmapped', 'No person here is mapped to this subject');
  const operations = options.onBehalfOfOperations.filter(
    (operation) => !mapping.operations || mapping.operations.includes(operation),
  );
  return {
    workspaceId,
    principalId: mapping.principalId,
    grant: { operations, principalId: mapping.principalId, workspaceId },
    peer: { id: peer.id, subject: claims.sub },
  };
}

/** `sub` of a well-formed assertion, unverified; only used to look its mapping up. */
function unverifiedSubject(header: string): string | undefined {
  const claims = header.split('.')[1];
  if (!claims || !/^[A-Za-z0-9_-]{1,4096}$/.test(claims)) return undefined;
  try {
    const sub = (JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as { sub?: unknown })
      .sub;
    return typeof sub === 'string' && sub.length > 0 && sub.length <= 200 ? sub : undefined;
  } catch {
    return undefined;
  }
}
