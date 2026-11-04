import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';

/**
 * The managed configuration plugin: settings a fleet administrator pushes through device
 * management (Android app restrictions, iOS managed app configuration) become other plugins'
 * settings. It adds no operations and declares no settings of its own.
 */
export const managedConfigPluginManifest = definePluginManifest({
  id: 'managed-config',
  title: 'Managed configuration',
  platforms: ['android', 'ios'],
  native: {
    module: 'TortoiseManagedConfig',
    expoPlugin: '@tortoise/managed-config/app.plugin',
  },
});

export default managedConfigPluginManifest;
