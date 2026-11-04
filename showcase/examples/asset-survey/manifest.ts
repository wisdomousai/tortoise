import { approvalFeatureManifest } from '@tortoise/contracts';
import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { deviceLinkPluginManifest } from '@tortoise/device-link/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { processPluginManifest } from '@tortoise/process/plugin-manifest';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
import { workflowsPluginManifest } from '@tortoise/workflows/plugin-manifest';
import { assignments, surveyModules } from './contracts';

/** Browser-safe identity of the asset survey hub. */
export default defineManifest({
  id: 'asset-survey',
  title: 'Asset survey',
  modules: surveyModules,
  features: [assignments.manifest, approvalFeatureManifest],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    processPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    deviceLinkPluginManifest,
    workflowsPluginManifest,
  ],
  targets: ['desktop', 'web'],
});
