import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { webhookPluginManifest } from '@agent-native/webhook/plugin-manifest';
import { projectTasksModule } from './contracts';

/**
 * Browser-safe identity of the project-tasks application: what generators and screens read.
 * Besides the site, network, audit and compliance plugins it composes the webhook example
 * plugin, so one application shows a third-party plugin next to the framework's own.
 */
export default defineManifest({
  id: 'project-tasks',
  title: 'Project tasks',
  modules: [projectTasksModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    webhookPluginManifest,
  ],
});
