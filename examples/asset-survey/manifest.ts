import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { deviceLinkPluginManifest } from '@agent-native/device-link/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { workflowsPluginManifest } from '@agent-native/workflows/plugin-manifest';
import { surveyModules } from './contracts';

/** Browser-safe identity of the asset survey hub. */
export default defineManifest({
  id: 'asset-survey',
  title: 'Asset survey',
  modules: surveyModules,
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
