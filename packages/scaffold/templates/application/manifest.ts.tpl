import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { {{app.camel}}Module } from './contracts';
// scaffold:imports

/** Browser-safe identity of the {{displayName}} application. */
export default defineManifest({
  id: '{{app.kebab}}',
  title: {{displayName.literal}},
  modules: [{{app.camel}}Module],
  features: [
    // scaffold:features
  ],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
  ],
});
