import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';

/**
 * The intent scanner plugin: scans that a rugged Android device's scanner app broadcasts as
 * intents. It adds no operations; it brings the native receiver and refuses to start in a build
 * without it. Android only: iOS has no broadcast intents.
 */
export const intentScannerPluginManifest = definePluginManifest({
  id: 'intent-scanner',
  title: 'Intent scanner',
  platforms: ['android'],
  native: { module: 'AgentNativeIntentScanner' },
});

export default intentScannerPluginManifest;
