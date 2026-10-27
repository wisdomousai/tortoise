import { defaultPorts } from '@agent-native/kernel';
import { defineHostPlugin, type NetworkPort } from '@agent-native/kernel/plugin';
import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/**
 * For tests of a site or a fleet: a plugin whose network port reaches the `fleet` destination
 * through `reach`, and refuses every other destination as the kernel default does. `reach` gets
 * the URL resolved against a placeholder origin; map its path onto the fleet under test, and
 * fail, drop or change responses there to stand in for an unreliable uplink. Compose it where the
 * network plugin would be.
 */
export function fleetNetworkFixture(reach: (url: URL, init?: RequestInit) => Promise<Response>) {
  const manifest = definePluginManifest({ id: 'fixture-network', title: 'Fixture network' });
  const fallback = defaultPorts().network;
  const network: NetworkPort = {
    ...fallback,
    client: (destination) => {
      if (destination !== 'fleet') return fallback.client(destination);
      return {
        destination,
        fetch: (input, init) => reach(new URL(String(input), 'http://fleet.invalid'), init),
      };
    },
  };
  return {
    manifest,
    plugin: defineHostPlugin({ manifest, open: async () => ({ ports: { network } }) }),
  };
}
