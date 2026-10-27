import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { deviceLinkPluginManifest } from '@agent-native/device-link/plugin-manifest';
import { fleetSiteModule } from '@agent-native/fleet-agent/contracts';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { fleetModule } from './contracts';

/** Browser-safe identity of the Fleet application. */
export default defineManifest({
  id: 'fleet',
  title: 'Fleet',
  modules: [fleetModule, fleetSiteModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    deviceLinkPluginManifest,
  ],
});
