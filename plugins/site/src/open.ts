import type { CatalogRequirements } from '@agent-native/contracts';
import {
  assertPolicyUsable,
  isolatedPolicy,
  loadSitePolicy,
  type ResolvedPolicy,
} from '@agent-native/egress';
import type { PluginInstance, PluginOpenContext } from '@agent-native/host/plugin';
import { assertIdentity } from './identity';
import { portsNeeded } from './needs';

/**
 * What the site plugin exposes to later plugins as `services.site`: the resolved policy and the
 * composed declarations it was resolved against. The network, audit and compliance plugins read
 * it; none of them loads the policy again.
 */
export interface SiteService {
  readonly policy: ResolvedPolicy;
  readonly requirements: CatalogRequirements;
}

/**
 * Resolve the site policy before anything serves or writes:
 *
 * 1. Load the `site-policy` file against the composed requirements, or the isolated default
 *    without one, and refuse on any error finding, profile floors included.
 * 2. Provide the identity port from the policy's identity floor.
 * 3. Declare the ports the policy needs (`portsNeeded`), so the host refuses a composition in
 *    which the policy binds destinations or requires an audit trail that nothing enforces.
 *
 * Throws on an unreadable or unusable policy.
 */
export async function openSite(context: PluginOpenContext): Promise<PluginInstance> {
  const requirements = context.catalog.requirements;
  const file = context.settings['site-policy'];
  const policy: ResolvedPolicy = file
    ? await loadSitePolicy(file, requirements)
    : isolatedPolicy(requirements);
  assertPolicyUsable(policy);
  const service: SiteService = { policy, requirements };
  return {
    ports: {
      identity: {
        admit: (caller) => assertIdentity(policy, caller),
        localOwnerSessions: policy.policy.identity === 'local-owner',
      },
    },
    needs: portsNeeded(policy, file !== undefined),
    service,
    describe: () => ({ profile: policy.profile, policyDigest: policy.digest }),
  };
}

/**
 * The site plugin's service among a host's plugin services, typed. Throws when the application
 * does not compose the site plugin, so a plugin that needs the policy cannot run without one.
 */
export function siteServiceOf(services: Readonly<Record<string, unknown>>): SiteService {
  const service = services.site as SiteService | undefined;
  if (!service) throw new Error('This application does not compose the site plugin');
  return service;
}
