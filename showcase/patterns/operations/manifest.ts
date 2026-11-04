import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { telemetryPluginManifest } from '@tortoise/telemetry/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';

/** The test requests module with the deployment, network, audit and telemetry plugins. Browser-safe. */
export default defineManifest({
  id: 'test-requests-operations',
  title: 'Oil test requests operations',
  modules: [testRequestsModule],
  plugins: [
    deploymentPluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    telemetryPluginManifest,
  ],
});
