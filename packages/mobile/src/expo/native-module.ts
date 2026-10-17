import { requireOptionalNativeModule } from 'expo-modules-core';
import type { PluginManifest } from '@agent-native/kernel/plugin-manifest';
import { requirePluginNativeModule } from '../native-module';

/**
 * The Expo module a plugin's manifest names in `native.module`. Call it from the plugin's `open`
 * (or `provideSettings`); it refuses startup when the build lacks the module.
 */
export function pluginNativeModule<Module>(manifest: PluginManifest): Module {
  return requirePluginNativeModule<Module>(manifest, requireOptionalNativeModule);
}
