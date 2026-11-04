import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
import { {{app.camel}}Module } from './contracts';
// scaffold:imports

/** Browser-safe identity of the {{displayName}} application. */
export default defineManifest({
  id: '{{app.kebab}}',
  title: {{displayName.literal}},
  // Each build is best before its build date plus this many days; nothing is refused after it.
  shelfLifeDays: 180,
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
