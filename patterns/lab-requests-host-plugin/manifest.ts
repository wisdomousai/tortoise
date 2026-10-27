import { defineManifest } from '@agent-native/host/manifest';
import { labRequestsModule } from '@agent-native/pattern-lab-requests/contracts';
import { activityPluginManifest } from './plugins/activity/plugin-manifest';

/** The lab requests module with the pattern's own activity plugin. Browser-safe. */
export default defineManifest({
  id: 'lab-requests-host-plugin',
  title: 'Lab requests with activity',
  modules: [labRequestsModule],
  plugins: [activityPluginManifest],
});
