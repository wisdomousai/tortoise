import { defineHostPlugin } from '@tortoise/kernel/plugin';
import { pluginNativeModule } from '@tortoise/mobile/expo';
import { intentScannerPluginManifest } from '../plugin-manifest';

/**
 * The plugin's part in the instance. It only checks, when the instance opens, that the build
 * contains the native receiver, so a missing `expo prebuild` shows at startup. Screens start
 * scanning with `intentSource`.
 */
export const intentScannerPlugin = defineHostPlugin({
  manifest: intentScannerPluginManifest,
  async open() {
    pluginNativeModule(intentScannerPluginManifest);
    return {};
  },
});

export default intentScannerPlugin;
