import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { pluginNativeModule } from '@agent-native/mobile/expo';
import { intentScannerPluginManifest } from '../plugin-manifest';

/**
 * The plugin's part in the authority. It only checks, when the authority opens, that the build
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
