import type { PeerSurface } from '@agent-native/contracts';
import type { IntegrationLane } from '@agent-native/runtime';

/** The service principal of an enrolled peer, as the peer link authenticates it. */
export const peerPrincipal = (peerId: string) => `peer:${peerId}`;
export const isPeerPrincipal = (principalId: string) => principalId.startsWith('peer:');

/**
 * The policy lane of every enrolled peer's service principal, for `definePolicy`: it may call the
 * surface's service operations and nothing else, and reads no journal events. The peer link's
 * grant narrows it further per peer. A call on behalf of a person is no lane: it runs as that
 * person, under the rules for people.
 *
 * Every service operation needs a rule in the policy; `integration` keeps it to lanes.
 */
export function peerLane<State>(
  surface: PeerSurface,
  allow?: IntegrationLane<State>['allow'],
): IntegrationLane<State> {
  return {
    is: (_state, principalId) => isPeerPrincipal(principalId),
    operations: surface.serviceOperations,
    events: () => false,
    ...(allow ? { allow } : {}),
  };
}
