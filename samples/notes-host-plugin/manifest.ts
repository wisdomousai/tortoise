import { defineManifest } from '@agent-native/host/manifest';
import { notesModule } from '@agent-native/sample-notes/contracts';
import { activityPluginManifest } from './plugins/activity/plugin-manifest';

/** The notes module with the sample's own activity plugin. Browser-safe. */
export default defineManifest({
  id: 'notes-host-plugin',
  title: 'Notes with activity',
  modules: [notesModule],
  plugins: [activityPluginManifest],
});
