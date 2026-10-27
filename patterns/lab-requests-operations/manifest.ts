import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { telemetryPluginManifest } from '@agent-native/telemetry/plugin-manifest';
import { labRequestsModule } from '@agent-native/pattern-lab-requests/contracts';

/** The lab requests module with the site, network, audit and telemetry plugins. Browser-safe. */
export default defineManifest({
  id: 'lab-requests-operations',
  title: 'Lab requests operations',
  modules: [labRequestsModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    telemetryPluginManifest,
  ],
});
