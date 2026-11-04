import { defineManifest } from '@tortoise/host/manifest';
import { executionSandbox } from '@tortoise/execution-host/contracts';
import { executionHostPluginManifest } from '@tortoise/execution-host/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { processPluginManifest } from '@tortoise/process/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
import { testResultsModule } from './contracts';
import {
  ANALYSIS_SANDBOX,
  resultAnalysisPluginManifest,
} from './plugins/result-analysis/plugin-manifest';

/**
 * The test requests module, test results with the result analyst, and the sandbox its tool runs
 * in. The sandbox declares no destinations, so it reaches nothing but the host's own API. The
 * deployment, network and process plugins come before the execution host, which needs the process port.
 * Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-sandbox',
  title: 'Oil test requests with sandboxed analysis',
  modules: [testRequestsModule, testResultsModule],
  components: [
    executionSandbox({
      id: ANALYSIS_SANDBOX,
      description: 'Runs the result analyst tool, which reads and records through the CLI',
    }),
  ],
  plugins: [
    deploymentPluginManifest,
    networkPluginManifest,
    processPluginManifest,
    executionHostPluginManifest,
    resultAnalysisPluginManifest,
  ],
});
