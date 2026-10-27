import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';
import { publishingModule } from './contracts';

/**
 * The test requests module and publishing, with the plugins that bind and guard the LIMS's
 * destination. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-system-of-record',
  title: 'Lab request publishing',
  modules: [testRequestsModule, publishingModule],
  plugins: [sitePluginManifest, networkPluginManifest, auditPluginManifest],
});
