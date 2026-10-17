import { defineManifest } from '@agent-native/kernel/manifest';
import type { PluginManifest } from '@agent-native/kernel/plugin-manifest';
import { hubLinkPluginManifest } from '@agent-native/hub-link/plugin-manifest';
import { intentScannerPluginManifest } from '@agent-native/intent-scanner/plugin-manifest';
import { managedConfigPluginManifest } from '@agent-native/managed-config/plugin-manifest';
import { fieldModule } from './contracts';

/**
 * The field app's identity for the plugins one build composes. A host opens only plugins that
 * run on its platform and the manifest must list exactly the composed ones, so an iOS build
 * leaves out the Android intent scanner and a Bun test leaves out both native plugins.
 */
export function fieldManifest(plugins: readonly PluginManifest[]) {
  return defineManifest({
    id: 'asset-survey-field',
    title: 'Asset survey field',
    modules: [fieldModule],
    plugins,
    targets: ['mobile'],
    // The capture screen takes stills only, so the build asks for the camera and not the
    // microphone.
    expoPlugins: [
      {
        plugin: 'expo-camera',
        options: {
          cameraPermission: 'Photograph equipment and nameplates for the site survey.',
          microphonePermission: false,
          recordAudioAndroid: false,
          barcodeScannerEnabled: false,
        },
      },
    ],
  });
}

/** Every plugin any build composes: what `mobile:prepare` reads for native config plugins. */
export default fieldManifest([
  hubLinkPluginManifest,
  managedConfigPluginManifest,
  intentScannerPluginManifest,
]);
