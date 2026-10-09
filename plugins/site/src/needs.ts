import type { ResolvedPolicy } from '@agent-native/egress';
import type { HostPorts } from '@agent-native/host/plugin';

/**
 * The ports a supplied policy depends on other plugins to provide. A policy file that binds
 * destinations needs a network guard, one that selects mTLS needs the listener, and one that
 * asks for an audit trail (fail-closed or forwarded) needs an event log. Without a file the
 * application runs isolated and needs nothing.
 */
export function portsNeeded(policy: ResolvedPolicy, supplied: boolean): (keyof HostPorts)[] {
  if (!supplied) return [];
  const { audit, ingress } = policy.policy;
  return [
    ...(audit.mode === 'fail-closed' || audit.forwardTo ? (['eventLog'] as const) : []),
    ...(policy.mode === 'connected' ? (['network'] as const) : []),
    ...(ingress.listen === 'mtls' ? (['ingress'] as const) : []),
  ];
}
