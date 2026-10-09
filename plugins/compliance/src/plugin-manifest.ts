import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { complianceModule } from './contracts';

/**
 * The browser-safe part of the compliance plugin: the auditor queries (`compliance.*`) every
 * composing application exposes to its listed auditors. Requires the site and audit plugins,
 * whose policy and log the queries report on.
 */
export const compliancePluginManifest = definePluginManifest({
  id: 'compliance',
  title: 'Compliance',
  modules: [complianceModule],
});
