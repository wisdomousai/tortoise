import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';

/**
 * The browser-safe part of the OS shortcuts plugin. It adds no module and no setting: the
 * shortcut handlers it serves are declared by the application's modules, and the launcher
 * entries are generated from them by the framework.
 */
export const osShortcutsPluginManifest = definePluginManifest({
  id: 'os-shortcuts',
  title: 'OS shortcuts',
  platforms: ['bun', 'android', 'ios'],
});

export default osShortcutsPluginManifest;
