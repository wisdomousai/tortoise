import { definePluginManifest } from '@tortoise/host/plugin-manifest';
import { activityModule } from './contracts';

/**
 * The browser-safe part of the activity plugin: its module and one setting. It declares no
 * components, because it reaches no network, device or process.
 */
export const activityPluginManifest = definePluginManifest({
  id: 'activity',
  title: 'Activity',
  modules: [activityModule],
  settings: [
    {
      key: 'activity-modules',
      env: 'TORTOISE_ACTIVITY_MODULES',
      kind: 'string',
      description: 'comma-separated modules whose commands are counted; absent: every module',
    },
  ],
});
