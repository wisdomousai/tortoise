import { defineManifest } from '@agent-native/host/manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';
import { methodSuggestionsModule } from './contracts';

/**
 * The test requests module, approval requests with the method suggester, and automation.
 * Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-agents',
  title: 'Oil test requests with agents',
  modules: [testRequestsModule, methodSuggestionsModule],
  plugins: [automationPluginManifest],
});
