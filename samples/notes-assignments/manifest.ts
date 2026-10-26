import { defineManifest } from '@agent-native/host/manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { peerLinkPluginManifest } from '@agent-native/peer-link/plugin-manifest';
import { notesModule } from '@agent-native/sample-notes/contracts';
import { assignments, noteReviewsModule } from './contracts';

/**
 * The notes module, note reviews as assignments, automation for the reviewer agent and the peer
 * link that serves reviews to another application. Browser-safe.
 */
export default defineManifest({
  id: 'notes-assignments',
  title: 'Notes reviews',
  modules: [notesModule, noteReviewsModule],
  features: [assignments.manifest],
  plugins: [automationPluginManifest, peerLinkPluginManifest],
});
