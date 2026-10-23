import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { workflowsModule } from './contracts';

/**
 * The browser-safe part of the workflows plugin: its module of workflow instances. It reaches
 * nothing outside the application; each step calls an operation through the instance.
 */
export const workflowsPluginManifest = definePluginManifest({
  id: 'workflow',
  title: 'Workflows',
  modules: [workflowsModule],
});
