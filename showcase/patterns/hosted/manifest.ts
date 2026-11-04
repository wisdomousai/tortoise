import { defineManifest } from '@tortoise/host/manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';

/**
 * The test requests module with the plugins a hosted instance needs for workforce sign-in: the
 * deployment policy, which names the identity provider, and the network guard, through which the
 * host reaches it. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-hosted',
  title: 'Lab request desk',
  modules: [testRequestsModule],
  plugins: [deploymentPluginManifest, networkPluginManifest],
});
