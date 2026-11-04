import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { stationSignInModule } from './contracts';

/**
 * Shared-station sign-in: an operator scans their badge at a terminal and enters a PIN, and gets a
 * short-lived session of their own while the terminal keeps its own. It runs on a serving Bun host.
 */
export const stationSignInPluginManifest = definePluginManifest({
  id: 'station-sign-in',
  title: 'Station sign-in',
  // Operation ids predate the namespace rule.
  namespace: 'station',
  modules: [stationSignInModule],
  settings: [
    {
      key: 'station-sign-in-terminals',
      env: 'TORTOISE_STATION_SIGN_IN_TERMINALS',
      kind: 'string',
      description:
        'comma-separated principals whose screens are station terminals, besides the local user; absent: only the local user',
    },
    {
      key: 'station-sign-in-minutes',
      env: 'TORTOISE_STATION_SIGN_IN_MINUTES',
      kind: 'string',
      description: 'how long an operator session lasts, in minutes; default 15',
    },
  ],
});

export default stationSignInPluginManifest;
