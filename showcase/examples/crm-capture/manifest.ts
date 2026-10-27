import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { crmCaptureModule } from './contracts';

/** Browser-safe identity of the CRM capture application. */
export default defineManifest({
  id: 'crm-capture',
  title: 'CRM capture',
  modules: [crmCaptureModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
  ],
});
