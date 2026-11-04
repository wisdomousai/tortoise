import { defineManifest } from '@tortoise/host/manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
import { activityPluginManifest } from './plugins/activity/plugin-manifest';

/** The test requests module with the pattern's own activity plugin. Browser-safe. */
export default defineManifest({
  id: 'test-requests-host-plugin',
  title: 'Oil test requests with activity',
  modules: [testRequestsModule],
  plugins: [activityPluginManifest],
});
