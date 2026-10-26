import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { peerLinkPluginManifest } from '@agent-native/peer-link/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { notesModule } from '@agent-native/sample-notes/contracts';
import { worklist } from './contracts';

/**
 * The notes module and a worklist of note reviews from notes-assignments, with the peer link and
 * the plugins that bind and guard its destination. Browser-safe.
 */
export default defineManifest({
  id: 'notes-worklist',
  title: 'Notes worklist',
  modules: [notesModule, worklist.module],
  components: [worklist.target.component],
  plugins: [sitePluginManifest, networkPluginManifest, auditPluginManifest, peerLinkPluginManifest],
});
