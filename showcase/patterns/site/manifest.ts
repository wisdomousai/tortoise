import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { fleetAgentPluginManifest } from '@tortoise/fleet-agent/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';

/**
 * The test requests module with the plugins a site instance runs: the deployment policy, the
 * network guard, the audit log and the fleet agent, in that order. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-site',
  title: 'Lab site',
  modules: [testRequestsModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    fleetAgentPluginManifest,
  ],
});
