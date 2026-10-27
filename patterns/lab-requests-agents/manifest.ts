import { defineManifest } from '@agent-native/host/manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { labRequestsModule } from '@agent-native/pattern-lab-requests/contracts';
import { methodSuggestionsModule } from './contracts';

/**
 * The lab requests module, approval requests with the method suggester, and automation.
 * Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-agents',
  title: 'Lab requests with agents',
  modules: [labRequestsModule, methodSuggestionsModule],
  plugins: [automationPluginManifest],
});
