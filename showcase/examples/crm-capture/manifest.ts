import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { crmCaptureModule } from './contracts';

/** Browser-safe identity of the CRM capture application. */
export default defineManifest({
  id: 'crm-capture',
  title: 'CRM capture',
  modules: [crmCaptureModule],
  plugins: [
    deploymentPluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
  ],
});
