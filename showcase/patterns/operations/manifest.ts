import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { telemetryPluginManifest } from '@agent-native/telemetry/plugin-manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';

/** The test requests module with the site, network, audit and telemetry plugins. Browser-safe. */
export default defineManifest({
  id: 'test-requests-operations',
  title: 'Oil test requests operations',
  modules: [testRequestsModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    telemetryPluginManifest,
  ],
});
