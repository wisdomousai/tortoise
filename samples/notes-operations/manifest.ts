import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { telemetryPluginManifest } from '@agent-native/telemetry/plugin-manifest';
import { notesModule } from '@agent-native/sample-notes/contracts';

/** The notes module with the site, network, audit and telemetry plugins. Browser-safe. */
export default defineManifest({
  id: 'notes-operations',
  title: 'Notes operations',
  modules: [notesModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    telemetryPluginManifest,
  ],
});
