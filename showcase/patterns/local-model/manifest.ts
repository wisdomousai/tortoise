import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { automationPluginManifest } from '@tortoise/automation/plugin-manifest';
import { modelServerPluginManifest } from '@tortoise/model-server/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { processPluginManifest } from '@tortoise/process/plugin-manifest';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
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
