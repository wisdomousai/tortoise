import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { AndroidExtra, AndroidIntent, IntentListening } from '@tortoise/shell/intents';
import type { MobileOsBindings } from '../os';

/**
 * The name of the native module that carries activity intents. The framework names the module
 * and its calls; a plugin that serves intent handlers and actions brings the Android code under
 * this name, so a build without that plugin has no module and its bindings stay absent.
 */
export const osIntentsModuleName = 'AgentNativeOsIntents';

/** What the native module provides on Android. */
export interface OsIntentsNativeModule {
  /**
   * Pass on intents with an action in `listening` from now on, reading only the extras listed
   * for it, and return the launching intent once if it has one of them. A launch from the
   * recents list is not returned again.
   */
  listen(listening: IntentListening): unknown;
  /** Stop passing on intents. */
  stop(): void;
  /** Start an activity in `targetPackage` only; rejects when none takes the action. */
  start(
    action: string,
    targetPackage: string,
    extras: Readonly<Record<string, AndroidExtra>>,
  ): Promise<void>;
  addListener(event: 'onIntent', listener: (record: unknown) => void): { remove(): void };
}

/**
 * The intent bindings when the build has the native module on Android, otherwise none. The
 * launching intent is handed to the listener first, then each new one; what the module reports
 * is untrusted, and the mobile shell checks it before submitting.
 */
export function expoIntentBindings(): Pick<MobileOsBindings, 'intents' | 'startIntent'> {
  if (Platform.OS !== 'android') return {};
  const module = requireOptionalNativeModule<OsIntentsNativeModule>(osIntentsModuleName);
  if (!module) return {};
  return {
    intents(listening, listener) {
      const subscription = module.addListener('onIntent', listener);
      const launched = module.listen(listening);
      if (launched) listener(launched);
      return () => {
        subscription.remove();
        module.stop();
      };
    },
    startIntent: (intent: AndroidIntent) =>
      module.start(intent.action, intent.package, intent.extras ?? {}),
  };
}
