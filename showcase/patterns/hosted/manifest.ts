import { defineManifest } from '@agent-native/host/manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';

/**
 * The test requests module with the plugins a hosted instance needs for workforce sign-in: the
 * deployment policy, which names the identity provider, and the network guard, through which the
 * host reaches it. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-hosted',
  title: 'Lab request desk',
  modules: [testRequestsModule],
  plugins: [sitePluginManifest, networkPluginManifest],
});
