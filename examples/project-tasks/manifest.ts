import { defineManifest } from '@agent-native/host/manifest';
import { assurancePluginManifest } from '@agent-native/assurance/plugin-manifest';
import { securityPluginManifest } from '@agent-native/security/plugin-manifest';
import { webhookPluginManifest } from '@agent-native/webhook/plugin-manifest';
import { projectTasksModule } from './contracts';

/**
 * Browser-safe identity of the project-tasks application: what generators and screens read.
 * Besides the security and assurance plugins it composes the webhook example plugin, so one
 * application shows a third-party plugin next to the framework's own.
 */
export default defineManifest({
  id: 'project-tasks',
  title: 'Project tasks',
  modules: [projectTasksModule],
  plugins: [securityPluginManifest, assurancePluginManifest, webhookPluginManifest],
});
