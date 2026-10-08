import { defineManifest } from '@agent-native/host/manifest';
import { assurancePluginManifest } from '@agent-native/assurance/plugin-manifest';
import { securityPluginManifest } from '@agent-native/security/plugin-manifest';
import { crmCaptureModule } from './contracts';

/** Browser-safe identity of the CRM capture application. */
export default defineManifest({
  id: 'crm-capture',
  title: 'CRM capture',
  modules: [crmCaptureModule],
  plugins: [securityPluginManifest, assurancePluginManifest],
});
