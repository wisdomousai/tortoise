/**
 * Device bindings for the mobile platform on Expo. Import this entry first in the app, before any
 * framework code runs, so the Web globals Hermes lacks are installed before they are needed.
 */
import { installGlobals } from '@tortoise/kernel/globals';
import { getRandomValues } from 'expo-crypto';
import { Platform } from 'react-native';
import { createMobilePlatform } from '../platform';
import { expoBlobStore } from './blob-store';
import { expoSecretStore } from './secrets';
import { expoSqlDriver } from './sql-driver';

installGlobals({ getRandomValues: (array) => getRandomValues(array) });

/** The platform of the device the app runs on, with Expo's SQLite and file system. */
export function expoPlatform() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios')
    throw new Error(`The mobile platform runs on Android and iOS, not ${Platform.OS}`);
  return createMobilePlatform({
    id: Platform.OS,
    openDatabase: expoSqlDriver,
    openBlobs: expoBlobStore,
    secrets: expoSecretStore,
  });
}

export { expoBlobStore } from './blob-store';
export { expoSecretStore } from './secrets';
export { expoSqlDriver } from './sql-driver';
export { defineBackgroundDelivery, followAppState } from './lifecycle';
export { pluginNativeModule } from './native-module';
export { expoOsBindings } from './os-shell';
export { expoIntentBindings, osIntentsModuleName, type OsIntentsNativeModule } from './os-intents';
