import { defineManifest } from '@agent-native/host/manifest';
import { executionSandbox } from '@agent-native/execution-host/contracts';
import { executionHostPluginManifest } from '@agent-native/execution-host/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { labRequestsModule } from '@agent-native/sample-lab-requests/contracts';
import { testResultsModule } from './contracts';
import {
  ANALYSIS_SANDBOX,
  resultAnalysisPluginManifest,
} from './plugins/result-analysis/plugin-manifest';

/**
 * The lab requests module, test results with the result analyst, and the sandbox its tool runs
 * in. The sandbox declares no destinations, so it reaches nothing but the host's own API. The
 * site, network and process plugins come before the execution host, which needs the process port.
 * Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-sandbox',
  title: 'Lab requests with sandboxed analysis',
  modules: [labRequestsModule, testResultsModule],
  components: [
    executionSandbox({
      id: ANALYSIS_SANDBOX,
      description: 'Runs the result analyst tool, which reads and records through the CLI',
    }),
  ],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    processPluginManifest,
    executionHostPluginManifest,
    resultAnalysisPluginManifest,
  ],
});
