import { approvalFeatureManifest } from '@tortoise/contracts';
import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { notificationsPluginManifest } from '@tortoise/notifications/plugin-manifest';
import { osPluginManifest } from '@tortoise/os/plugin-manifest';
import { osShortcutsPluginManifest } from '@tortoise/os-shortcuts/plugin-manifest';
import { shareTargetPluginManifest } from '@tortoise/share-target/plugin-manifest';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
import { webhookPluginManifest } from '@tortoise/webhook/plugin-manifest';
import { workOrderPlannerModule, fieldServiceModule } from './contracts';

/**
 * Browser-safe identity of the field-service application: what generators and screens read.
 * The planner agent's module needs the `approval` feature, which keeps its approval requests.
 * Besides the site, network, audit and compliance plugins it composes the OS plugin, which
 * handles its task links and text files, the share target plugin, which takes what other apps
 * share to it, the notifications plugin, which shows task reminders, the OS shortcuts plugin, whose
 * launcher entry starts a new task, and the webhook example plugin, so one application
 * shows a third-party plugin next to the framework's own.
 */
export default defineManifest({
  id: 'field-service',
  title: 'Field service',
  shelfLifeDays: 180,
  modules: [fieldServiceModule, workOrderPlannerModule],
  features: [approvalFeatureManifest],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    osPluginManifest,
    shareTargetPluginManifest,
    notificationsPluginManifest,
    osShortcutsPluginManifest,
    webhookPluginManifest,
  ],
});
