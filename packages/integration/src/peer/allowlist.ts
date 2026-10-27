import type { PeerApi } from '@agent-native/contracts';
import type { IntegrationAllowlist } from '@agent-native/runtime';

/** The service principal of an enrolled peer, as the peer link authenticates it. */
export const peerPrincipal = (peerId: string) => `peer:${peerId}`;
export const isPeerPrincipal = (principalId: string) => principalId.startsWith('peer:');

/**
 * The integration allowlist of every enrolled peer's service principal, for `definePolicy`: it
 * may call the API's service operations and nothing else, and reads no journal events. The
 * peer link's grant narrows it further per peer. A call on behalf of a person is not on it: it
 * runs as that person, under the rules for people.
 *
 * Every service operation needs a rule in the policy; `integration` keeps it to allowlists.
 */
export function peerAllowlist<State>(
  api: PeerApi,
  allow?: IntegrationAllowlist<State>['allow'],
): IntegrationAllowlist<State> {
  return {
    is: (_state, principalId) => isPeerPrincipal(principalId),
    operations: api.serviceOperations,
    events: () => false,
    ...(allow ? { allow } : {}),
  };
}
