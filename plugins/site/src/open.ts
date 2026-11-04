import { join } from 'node:path';
import { ApplicationError, type CatalogRequirements } from '@tortoise/contracts';
import { assertPolicyUsable, isolatedPolicy, loadSitePolicy, type ResolvedPolicy } from './policy';
import type { PluginInstance, PluginOpenContext } from '@tortoise/host/plugin';
import { assertIdentity } from './identity';
import { portsNeeded } from './needs';
import { createWorkforceSignIn } from './workforce/sign-in';

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
 * 2. Provide the identity port from the policy's identity floor and, for `identity: external`
 *    on a serving host, the workforce sign-in routes and the session cookies they set.
 *    Provide the folder port from the policy's folder bindings.
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
  const { workforce } = policy.policy;
  // Policy validation already refused `external` without a workforce provider.
  const signIn =
    workforce && policy.policy.identity === 'external' && context.serving
      ? createWorkforceSignIn(workforce, {
          fetch: () => context.ports.network.client('workforce-idp').fetch,
          sessions: join(context.workspacePath, 'workforce-sessions.sqlite'),
        })
      : undefined;
  return {
    ports: {
      identity: {
        admit: (caller) => assertIdentity(policy, caller, context.serving),
        localOwnerSessions: policy.policy.identity === 'local-owner',
      },
      folders: {
        folder(folderId) {
          const bound = policy.folders.get(folderId);
          if (!bound)
            throw new ApplicationError(
              'UNAVAILABLE',
              policy.disabledFolders.has(folderId)
                ? `Folder ${folderId} is disabled by the site policy`
                : `Folder ${folderId} is not bound by the site policy`,
            );
          return { id: folderId, path: bound.path, access: bound.folder.access };
        },
      },
    },
    ...(signIn
      ? {
          publicRoute: signIn.publicRoute,
          authenticateCookie: signIn.authenticateCookie,
          close: async () => signIn.close(),
        }
      : {}),
    // A bound workforce provider makes the policy connected, so the network port is needed.
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
