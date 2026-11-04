import {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
} from 'expo-secure-store';
import type { SecretStore } from '@tortoise/kernel/platform';

/**
 * The device's keystore (Android) or keychain (iOS) through `expo-secure-store`. Items are
 * readable only after the device was first unlocked since boot, so a background task can read
 * them while the screen is locked, and they never move to another device with a backup (iOS;
 * Android keystore keys never leave the device).
 */
const options = { keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export const expoSecretStore: SecretStore = {
  get: async (name) => (await getItemAsync(name, options)) ?? undefined,
  set: (name, value) => setItemAsync(name, value, options),
  delete: (name) => deleteItemAsync(name, options),
};
