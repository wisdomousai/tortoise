import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { labRequestsModule } from '@agent-native/sample-lab-requests/contracts';
import { chamberBroker, chamberGateway, chamberModule } from './contracts';

/**
 * The lab requests module and the climate chambers, with the chamber gateway and broker declared
 * as read-only site components and the plugins that bind and guard them. Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-signals',
  title: 'Lab chamber conditions',
  modules: [labRequestsModule, chamberModule],
  components: [chamberGateway, chamberBroker],
  plugins: [sitePluginManifest, networkPluginManifest, auditPluginManifest],
});
