import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';
import { stationSignInModule } from './contracts';

/**
 * Shared-station sign-in: an operator scans their badge at a seat and enters a PIN, and gets a
 * short-lived session of their own while the seat keeps its own. It runs on a serving Bun host.
 */
export const stationSignInPluginManifest = definePluginManifest({
  id: 'station-sign-in',
  title: 'Station sign-in',
  modules: [stationSignInModule],
  settings: [
    {
      key: 'station-sign-in-seats',
      env: 'AGENT_NATIVE_STATION_SIGN_IN_SEATS',
      kind: 'string',
      description:
        'comma-separated principals whose screens are station seats, besides the local owner; absent: only the local owner',
    },
    {
      key: 'station-sign-in-minutes',
      env: 'AGENT_NATIVE_STATION_SIGN_IN_MINUTES',
      kind: 'string',
      description: 'how long an operator session lasts, in minutes; default 15',
    },
  ],
});

export default stationSignInPluginManifest;
