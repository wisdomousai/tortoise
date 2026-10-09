import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/**
 * The browser-safe part of the network plugin. It declares nothing of its own: it binds what the
 * application and the other plugins declare, under the site plugin's policy.
 */
export const networkPluginManifest = definePluginManifest({
  id: 'network',
  title: 'Network',
});
