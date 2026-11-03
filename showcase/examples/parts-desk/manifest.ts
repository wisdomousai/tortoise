import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { modelServerPluginManifest } from '@agent-native/model-server/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { partsDeskModule } from './contracts';
import { assistantModelServer } from './contracts/assistant-agent';
import { approvalFeatureManifest } from '@agent-native/contracts';
// scaffold:imports

/**
 * Browser-safe identity of the Parts Desk application, with the model server process the
 * assistant runs on and the plugins that bind, start and audit it.
 */
export default defineManifest({
  id: 'parts-desk',
  title: 'Parts Desk',
  // Each build is best before its build date plus this many days; nothing is refused after it.
  shelfLifeDays: 180,
  modules: [partsDeskModule],
  components: [assistantModelServer],
  features: [
    approvalFeatureManifest,
    // scaffold:features
  ],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    processPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    modelServerPluginManifest,
  ],
});
