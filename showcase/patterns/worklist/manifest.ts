import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { peerLinkPluginManifest } from '@agent-native/peer-link/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';
import { worklist } from './contracts';

/**
 * The test requests module and a worklist of sampling rounds from the oil lab, with the peer link
 * and the plugins that bind and guard its destination. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-worklist',
  title: 'Field sampling worklist',
  modules: [testRequestsModule, worklist.module],
  components: [worklist.target.component],
  plugins: [sitePluginManifest, networkPluginManifest, auditPluginManifest, peerLinkPluginManifest],
});
