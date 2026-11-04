import { ApplicationError } from '@tortoise/contracts';
import type { PeerLink } from '@tortoise/integration';
import type { ExecutionContext, HandlerContext } from '@tortoise/runtime';
import type { PeerLinkState } from './state';

/** A peer target this application calls: the application it expects and its destination. */
export interface OutboundTarget {
  readonly application: string;
  readonly destination: string;
}

/** What the plugin hands its handlers and, as `services['peer-link']`, the application. */
export interface PeerLinkService {
  readonly now: () => number;
  /** This application's manifest ID; audiences name it. */
  readonly application: string;
  readonly serviceOperations: ReadonlySet<string>;
  readonly onBehalfOfOperations: ReadonlySet<string>;
  /** Whether a principal is never a peer's subject: a service, device or integration principal. */
  readonly reserved: (principalId: string) => boolean;
  /** The peer targets this application calls, by target ID. */
  readonly targets: ReadonlyMap<string, OutboundTarget>;
  /**
   * The connection to a peer target, for `connectPeerTarget` and `createPeerSource`. Its clients
   * throw while the target is not connected, which keeps effects pending.
   */
  link(target: string): PeerLink;
  /**
   * Connect to a peer target with the code its owner read out, as `context`, which must be
   * allowed to record connections. The connect route calls it for a person signed in here.
   */
  connect(
    request: { readonly target: string; readonly code: string },
    context: ExecutionContext,
  ): Promise<{ readonly connection: Record<string, unknown> }>;
}
export interface PeerLinkServices {
  readonly 'peer-link'?: PeerLinkService;
}

export function serviceOf(ctx: HandlerContext<PeerLinkState, PeerLinkServices>): PeerLinkService {
  const service = ctx.services['peer-link'];
  if (!service) throw new ApplicationError('UNAVAILABLE', 'Peer link is not open');
  return service;
}

/** The peer link's service among the application's plugin services, once the plugin is open. */
export const peerLinkServiceOf = (services: Readonly<Record<string, unknown>>) =>
  services['peer-link'] as PeerLinkService | undefined;
