import type { NativeNavigationItem, NativeScreenRoute } from './screens';

/**
 * What a host plugin contributes to the native frame: its screens, tabs and the screen each of its
 * capability families opens. Applications pass it to `defineNativeScreens({ plugins })`, which
 * places plugin tabs after the application's own.
 */
export interface PluginNativeScreens {
  /** The plugin manifest's id. */
  readonly id: string;
  readonly routes: readonly NativeScreenRoute[];
  readonly navigation?: readonly NativeNavigationItem[];
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
}

/** Declare a plugin's native screens. Checks run when an application composes them. */
export function definePluginNativeScreens(screens: PluginNativeScreens): PluginNativeScreens {
  return Object.freeze(screens);
}
