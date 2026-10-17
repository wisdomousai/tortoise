import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/authority';
import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { createHubLinkState, hubLinkHandlers, hubLinkPolicy, type HubLinkState } from './handlers';
import { hubNetworkPort } from './network';
import { createPairing, type HubLinkService } from './pairing';
import { hubLinkPluginManifest } from './plugin-manifest';

export type { HubLinkService } from './pairing';
export type { Pairing } from './handlers';

/** The pairing service of an open authority, for the plugin screen. */
export const hubLinkServiceOf = (services: Readonly<Record<string, unknown>>) =>
  services['hub-link'] as HubLinkService | undefined;

/**
 * The device side of pairing. It needs the platform's secret store for the credential and
 * provides the network port, so it cannot be composed with another network provider. When the
 * device is not paired and both `hub-url` and `enrollment-code` are set (device management), it
 * pairs in the background once the runtime is ready; a failure is recorded as the pairing error
 * and startup continues, since the hub may be out of reach.
 */
export function createHubLinkPlugin(
  options: { readonly fetch?: typeof fetch; readonly now?: () => number } = {},
) {
  return defineHostPlugin<HubLinkState>({
    manifest: hubLinkPluginManifest,
    state: { create: createHubLinkState },
    handlers: hubLinkHandlers,
    authorization: { resourceTypes: ['hub-pairing'], port: hubLinkPolicy },
    async open({ secrets, settings }) {
      if (!secrets)
        throw new Error(
          'Plugin "hub-link" needs a platform with a secret store for the device credential',
        );
      // This plugin is the device's network port, so it holds the platform's fetch; the port
      // and the enrollment exchange are the only callers, and both pin one origin.
      const platformFetch = options.fetch ?? fetch;
      const pairing = createPairing({
        secrets,
        fetch: platformFetch,
        now: options.now ?? Date.now,
      });
      const origin = settings['hub-url'];
      const code = settings['enrollment-code'];
      let background: Promise<unknown> = Promise.resolve();
      return {
        service: pairing.service,
        ports: { network: hubNetworkPort(pairing.current, platformFetch) },
        async ready(application) {
          const { paired } = await pairing.load(application, {
            workspaceId: LOCAL_WORKSPACE,
            principalId: LOCAL_OWNER,
          });
          if (!paired && origin && code)
            background = pairing.service.pair({ origin, code }).catch(() => undefined);
        },
        describe: () => ({ paired: pairing.current() !== undefined }),
        async close() {
          await background;
        },
      };
    },
  });
}

export const hubLinkPlugin = createHubLinkPlugin();
export default hubLinkPlugin;
