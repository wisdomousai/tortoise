import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { assuranceModule } from './contracts';

/**
 * The browser-safe part of the assurance plugin: the audit queries (`assurance.*`) every
 * composing application exposes to its listed auditors. Requires the security plugin, whose log
 * and policy the queries report on.
 */
export const assurancePluginManifest = definePluginManifest({
  id: 'assurance',
  title: 'Assurance',
  modules: [assuranceModule],
});
