import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';

/**
 * The browser-safe part of the Android intents plugin. It adds no module and no setting: the
 * intent handlers and intent actions it serves are declared by the application's modules. It
 * brings the native module `AgentNativeOsIntents`, which only Android builds contain; on the
 * desktop, the web and iOS the kinds are served and no intent arrives or starts.
 */
export const androidIntentsPluginManifest = definePluginManifest({
  id: 'android-intents',
  title: 'Android intents',
  platforms: ['bun', 'android', 'ios'],
  native: { module: 'AgentNativeOsIntents' },
});

export default androidIntentsPluginManifest;
