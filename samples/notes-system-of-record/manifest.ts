import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { notesModule } from '@agent-native/sample-notes/contracts';
import { publishingModule } from './contracts';

/**
 * The notes module and publishing, with the plugins that bind and guard the publisher's
 * destination. Browser-safe.
 */
export default defineManifest({
  id: 'notes-system-of-record',
  title: 'Notes publishing',
  modules: [notesModule, publishingModule],
  plugins: [sitePluginManifest, networkPluginManifest, auditPluginManifest],
});
