import type { PeerClient } from '../peer-call.js';

/**
 * A connection to a peer application, as the peer link's outbound side provides it. Each method
 * throws when the peer is not connected, which the peer port reports as a transient failure.
 */
export interface PeerLink {
  /** The peer's API as this application's service principal there. */
  client(): PeerClient;
  /**
   * The peer's API on behalf of a local person, named by their principal ID here. Every request
   * carries a fresh signed subject assertion; the peer maps the subject to one of its people.
   * `run` says an agent or job run made the call, which the peer refuses unless it allows runs.
   */
  onBehalfOf(subject: string, options?: { readonly run?: boolean }): PeerClient;
}
