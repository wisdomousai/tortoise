import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { fleetLinkComponent } from './contracts';

/**
 * The browser-safe part of the fleet agent: no module of its own, the fleet destination and the
 * release folder, and the settings a site sets to enroll and to opt in to staging and the relay.
 */
export const fleetAgentPluginManifest = definePluginManifest({
  id: 'fleet-agent',
  title: 'Fleet agent',
  components: [fleetLinkComponent],
  settings: [
    {
      key: 'fleet-enrollment-code',
      env: 'AGENT_NATIVE_FLEET_ENROLLMENT_CODE',
      kind: 'string',
      description: 'one-use code from the fleet; exchanged for the site credential on first start',
    },
    {
      key: 'fleet-trust',
      env: 'AGENT_NATIVE_FLEET_TRUST',
      kind: 'path',
      description:
        'path of the release signing keys (bundle key.pub.json, or an array of them); absent: releases are not staged',
    },
    {
      key: 'fleet-relay',
      env: 'AGENT_NATIVE_FLEET_RELAY',
      kind: 'string',
      description: '`on`: forward remote-access requests from the fleet to this host’s own API',
    },
  ],
});
