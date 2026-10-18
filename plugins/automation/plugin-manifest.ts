import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { automationModule } from './contracts';

/**
 * The browser-safe part of the automation plugin: its module of standing grants, trigger
 * progress and failures. It reaches nothing outside the application; runs call operations
 * through the instance like any other caller.
 */
export const automationPluginManifest = definePluginManifest({
  id: 'automation',
  title: 'Automation',
  modules: [automationModule],
});
