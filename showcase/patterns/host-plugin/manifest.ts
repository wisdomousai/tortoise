import { defineManifest } from '@agent-native/host/manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';
import { activityPluginManifest } from './plugins/activity/plugin-manifest';

/** The test requests module with the pattern's own activity plugin. Browser-safe. */
export default defineManifest({
  id: 'test-requests-host-plugin',
  title: 'Oil test requests with activity',
  modules: [testRequestsModule],
  plugins: [activityPluginManifest],
});
