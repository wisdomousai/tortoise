import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { modelServerPluginManifest } from '@tortoise/model-server/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { processPluginManifest } from '@tortoise/process/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { partsDeskModule } from './contracts';
import { assistantModelServer } from './contracts/assistant-agent';
import { approvalFeatureManifest } from '@tortoise/contracts';
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
    deploymentPluginManifest,
    networkPluginManifest,
    processPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    modelServerPluginManifest,
  ],
});
