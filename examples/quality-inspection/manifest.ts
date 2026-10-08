import { defineManifest } from '@agent-native/host/manifest';
import { assurancePluginManifest } from '@agent-native/assurance/plugin-manifest';
import { securityPluginManifest } from '@agent-native/security/plugin-manifest';
import { qualityInspectionModule } from './contracts';

/** Browser-safe identity of the quality-inspection application. */
export default defineManifest({
  id: 'quality-inspection',
  title: 'Quality inspection',
  modules: [qualityInspectionModule],
  plugins: [securityPluginManifest, assurancePluginManifest],
});
