import { definePluginManifest } from '@tortoise/host/plugin-manifest';
import { fleetLinkComponent } from './contracts';

/**
 * The browser-safe part of the fleet agent: no module of its own, the fleet destination and the
 * release folder, and the settings an instance sets to enroll and to opt in to staging and the relay.
 */
export const fleetAgentPluginManifest = definePluginManifest({
  id: 'fleet-agent',
  title: 'Fleet agent',
  components: [fleetLinkComponent],
  settings: [
    {
      key: 'fleet-enrollment-code',
      env: 'TORTOISE_FLEET_ENROLLMENT_CODE',
      kind: 'string',
      description:
        'one-use code from the fleet; exchanged for the instance credential on first start',
    },
    {
      key: 'fleet-trust',
      env: 'TORTOISE_FLEET_TRUST',
      kind: 'path',
      description:
        'path of the release signing keys (bundle key.pub.json, or an array of them); absent: releases are not staged',
    },
    {
      key: 'fleet-relay',
      env: 'TORTOISE_FLEET_RELAY',
      kind: 'string',
      description: '`on`: forward remote-access requests from the fleet to this host’s own API',
    },
  ],
});
