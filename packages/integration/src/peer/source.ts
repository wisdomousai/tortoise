import {
  ApplicationError,
  type AnyCapability,
  type ErrorCode,
  type JsonValue,
} from '@agent-native/contracts';
import type { RemoteSource, SourceCall } from '@agent-native/runtime';
import { createPeerCall, PeerCallError, type PeerClient } from '../peer-call.js';
import { createCursorSeal, type CursorSeal } from './cursor.js';
import type { PeerDrift } from './drift.js';
import type { PeerLink } from './link.js';

type Query = Record<string, JsonValue>;

/** How one local remote query reads the peer: which peer query, with what input, into which items. */
export interface PeerRead {
  readonly operation: string;
  readonly paged: boolean;
  input(query: Query): JsonValue;
  items(data: unknown): { readonly items: readonly unknown[]; readonly next?: string };
}

/**
 * Read one peer query that answers a single record, such as a lookup by ID: `items` turns its
 * answer into the page, by default one item, or none for a `null` answer.
 */
export function peerQuery(
  capability: AnyCapability & { readonly kind: 'query' },
  input: (query: Query) => JsonValue,
  items: (data: unknown) => readonly unknown[] = (data) => (data === null ? [] : [data]),
): PeerRead {
  return {
    operation: capability.id,
    paged: false,
    input,
    items: (data) => ({ items: items(data) }),
  };
}

/**
 * Read one paged peer query that answers `{ items, next? }` and takes `cursor`. The peer's
 * cursor reaches the caller sealed, bound to the query and the caller.
 */
export function peerList(
  capability: AnyCapability & { readonly kind: 'query' },
  input: (query: Query) => JsonValue,
): PeerRead {
  return {
    operation: capability.id,
    paged: true,
    input,
    items: (data) => data as { items: readonly unknown[]; next?: string },
  };
}

export interface PeerSourceOptions {
  readonly target: string;
  /** The connection; throws while the peer is not connected. */
  readonly link: () => PeerLink;
  /** Each local remote query this source answers, by its operation ID. */
  readonly reads: Readonly<Record<string, PeerRead>>;
  readonly drift?: PeerDrift;
  /** HMAC key of the page cursors; random per process by default. */
  readonly seal?: CursorSeal;
}

/** The peer's refusal reaches the caller with its code; everything else is the peer being away. */
function answer(target: string, error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (!(error instanceof PeerCallError))
    throw new ApplicationError('UNAVAILABLE', `${target} could not be read`);
  const assertion = (error.envelope?.details as { assertion?: unknown } | undefined)?.assertion;
  if (assertion === 'unmapped')
    throw new ApplicationError(
      'FORBIDDEN',
      `${target} maps no person to you; ask its owner to map you`,
    );
  if (error.kind === 'answered' && error.envelope && !assertion && error.status! < 500)
    throw new ApplicationError(error.envelope.code as ErrorCode, error.envelope.message);
  throw new ApplicationError('UNAVAILABLE', `${target} could not be read`);
}

/**
 * The remote source for a peer target: a local remote query (a data provider's search or
 * lookup) reads a peer query through the peer link.
 *
 * Identity: a query declared `service` reads as this application's service principal; every
 * other reads on behalf of the caller, so the peer applies the policy of the person the caller is
 * mapped to there. An unmapped caller is refused with `FORBIDDEN`. A drifted peer query is
 * `UNAVAILABLE`.
 */
export function createPeerSource(options: PeerSourceOptions): RemoteSource {
  const seal = options.seal ?? createCursorSeal();
  const clientFor = (call: SourceCall): PeerClient => {
    const link = options.link();
    return call.identity === 'service' ? link.client() : link.onBehalfOf(call.context.principalId);
  };
  return {
    async search(request, call) {
      const read = options.reads[request.operation];
      if (!read)
        throw new ApplicationError(
          'UNAVAILABLE',
          `${options.target} does not answer ${request.operation}`,
        );
      const { cursor, ...query } = request.query as Query & { cursor?: string };
      const principal = call.context.principalId;
      try {
        if (options.drift) {
          await options.drift.check();
          if (options.drift.blocked(read.operation))
            throw new ApplicationError(
              'UNAVAILABLE',
              `${read.operation} changed on ${options.target}; reads wait until the two applications agree`,
            );
        }
        const input = read.input(query);
        const peerCursor =
          read.paged && typeof cursor === 'string'
            ? seal.open(request.operation, query, principal, cursor)
            : undefined;
        const peer = createPeerCall({ client: () => clientFor(call) });
        const data = await peer.query(
          read.operation,
          peerCursor === undefined ? input : { ...(input as Query), cursor: peerCursor },
          call.signal,
        );
        const page = read.items(data);
        return {
          items: page.items,
          ...(read.paged && page.next
            ? { next: seal.seal(request.operation, query, principal, page.next) }
            : {}),
          identity: call.identity === 'service' ? 'service' : 'caller',
        };
      } catch (error) {
        if (error instanceof PeerCallError && error.code === 'INVALID_INPUT')
          options.drift?.invalidate();
        return answer(options.target, error);
      }
    },
  };
}
