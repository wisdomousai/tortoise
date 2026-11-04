import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
import { chamberBroker, chamberGateway, chamberModule } from './contracts';

/**
 * The test requests module and the climate chambers, with the chamber gateway and broker declared
 * as read-only host components and the plugins that bind and guard them. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-signals',
  title: 'Lab chamber conditions',
  modules: [testRequestsModule, chamberModule],
  components: [chamberGateway, chamberBroker],
  plugins: [deploymentPluginManifest, networkPluginManifest, auditPluginManifest],
});
