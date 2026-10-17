import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * Expo configuration from the starter's identity (`app.config.json`) and the native plugins and
 * OS registrations of the hosted application (`generated/native.json`, written by
 * `bun run mobile:prepare`): the URL scheme, Android intent filters, iOS associated domains and
 * document types, and the share target through `expo-sharing`, all generated from the
 * application's declared OS handlers.
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
  os?: {
    scheme: string;
    android: { intentFilters: NonNullable<ExpoConfig['android']>['intentFilters'] };
    ios: { associatedDomains: string[]; infoPlist: Record<string, unknown> };
    /** Config plugins the OS registrations need, such as `expo-sharing` for share handlers. */
    plugins: [string, Record<string, unknown>][];
  };
};
const os = native.os;

const config: ExpoConfig = {
  name: identity.displayName,
  slug: identity.name,
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  ...(os ? { scheme: os.scheme } : {}),
  ios: {
    bundleIdentifier: identity.appId,
    supportsTablet: true,
    ...(os?.ios.associatedDomains.length ? { associatedDomains: os.ios.associatedDomains } : {}),
    ...(os && Object.keys(os.ios.infoPlist).length ? { infoPlist: os.ios.infoPlist } : {}),
  },
  android: {
    package: identity.appId,
    ...(os?.android.intentFilters?.length ? { intentFilters: os.android.intentFilters } : {}),
  },
  // The background task needs its iOS background mode and scheduler identifier.
  plugins: ['expo-background-task', ...native.plugins, ...(os?.plugins ?? [])],
};

export default config;
