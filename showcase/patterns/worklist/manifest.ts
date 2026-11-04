import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { peerLinkPluginManifest } from '@tortoise/peer-link/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
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
  plugins: [
    deploymentPluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    peerLinkPluginManifest,
  ],
});
