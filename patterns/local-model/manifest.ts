import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { modelServerPluginManifest } from '@agent-native/model-server/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';
import { methodModelServer, methodSuggestionsModule } from './contracts';

/**
 * The test requests module, approval requests with the method suggester, the model server
 * process and the plugins that bind, start and audit it. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-local-model',
  title: 'Oil test requests on a local model',
  modules: [testRequestsModule, methodSuggestionsModule],
  components: [methodModelServer],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    processPluginManifest,
    auditPluginManifest,
    modelServerPluginManifest,
    automationPluginManifest,
  ],
});
