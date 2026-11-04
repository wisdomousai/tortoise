import { pluginNativeModule } from '@tortoise/mobile/expo';
import { createManagedConfigPlugin, type ManagedValues } from '../managed-config';
import { managedConfigPluginManifest } from '../plugin-manifest';

/**
 * The plugin on the device, reading through the native module. A build without the module
 * refuses startup when the plugin provides its settings, before any plugin opens.
 */
export const managedConfigPlugin = createManagedConfigPlugin(() =>
  pluginNativeModule<{ read(): ManagedValues }>(managedConfigPluginManifest).read(),
);

export default managedConfigPlugin;
