import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';

/**
 * The browser-safe part of the share target plugin. It adds no module and no setting: the share
 * handlers and share actions it serves are declared by the application's modules.
 */
export const shareTargetPluginManifest = definePluginManifest({
  id: 'share-target',
  title: 'Share target',
  // The web share target is a host route; on a device shares are received through the mobile shell.
  platforms: ['bun', 'android', 'ios'],
});
