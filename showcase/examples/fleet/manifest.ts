import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { deviceLinkPluginManifest } from '@tortoise/device-link/plugin-manifest';
import { fleetSiteModule } from '@tortoise/fleet-agent/contracts';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
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
