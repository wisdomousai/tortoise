import { defineManifest } from '@agent-native/host/manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { labRequestsModule } from '@agent-native/sample-lab-requests/contracts';

/**
 * The lab requests module with the plugins a hosted instance needs for workforce sign-in: the
 * deployment policy, which names the identity provider, and the network guard, through which the
 * host reaches it. Browser-safe.
 */
export default defineManifest({
  id: 'lab-requests-hosted',
  title: 'Lab request desk',
  modules: [labRequestsModule],
  plugins: [sitePluginManifest, networkPluginManifest],
});
