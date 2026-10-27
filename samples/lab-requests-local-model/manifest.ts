import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { modelServerPluginManifest } from '@agent-native/model-server/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { labRequestsModule } from '@agent-native/sample-lab-requests/contracts';
import { methodModelServer, methodSuggestionsModule } from './contracts';

/**
 * The lab requests module, approval requests with the method suggester, the model server
 * process and the plugins that bind, start and audit it. Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-local-model',
  title: 'Lab requests on a local model',
  modules: [labRequestsModule, methodSuggestionsModule],
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
