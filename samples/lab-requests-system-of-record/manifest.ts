import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { labRequestsModule } from '@agent-native/sample-lab-requests/contracts';
import { publishingModule } from './contracts';

/**
 * The lab requests module and publishing, with the plugins that bind and guard the LIMS's
 * destination. Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-system-of-record',
  title: 'Lab request publishing',
  modules: [labRequestsModule, publishingModule],
  plugins: [sitePluginManifest, networkPluginManifest, auditPluginManifest],
});
