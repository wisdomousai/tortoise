import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * Expo configuration from the starter's identity (`app.config.json`) and the native plugins of
 * the hosted application (`generated/native.json`, written by `bun run mobile:prepare`).
 * `ios/` and `android/` are generated from it by `expo prebuild` and never committed.
 */
const identity = JSON.parse(readFileSync(resolve(__dirname, '../../app.config.json'), 'utf8')) as {
  name: string;
  displayName: string;
  appId: string;
};
const nativeFile = resolve(__dirname, 'generated/native.json');
if (!existsSync(nativeFile)) throw new Error('No native plugin list: run bun run mobile:prepare');
const native = JSON.parse(readFileSync(nativeFile, 'utf8')) as {
  plugins: [string, Record<string, unknown>][];
};

const config: ExpoConfig = {
  name: identity.displayName,
  slug: identity.name,
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: identity.appId, supportsTablet: true },
  android: { package: identity.appId },
  // The background task needs its iOS background mode and scheduler identifier.
  plugins: ['expo-background-task', ...native.plugins],
};

export default config;
