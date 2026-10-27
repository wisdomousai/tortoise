import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { fleetAgentPluginManifest } from '@agent-native/fleet-agent/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { labRequestsModule } from '@agent-native/pattern-lab-requests/contracts';

/**
 * The lab requests module with the plugins a site instance runs: the deployment policy, the
 * network guard, the audit log and the fleet agent, in that order. Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-site',
  title: 'Lab site',
  modules: [labRequestsModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    fleetAgentPluginManifest,
  ],
});
