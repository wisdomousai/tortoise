import type { NavigationItem, ScreenRoute } from './screens';

/**
 * What a host plugin contributes to the web frame: its screens, sidebar entries and the screen
 * each of its capability families opens from the palette. Applications pass it to
 * `defineScreens({ plugins })`, which places plugin navigation after the application's own.
 * Browser-safe and free of `@/` imports so content can import it by package name.
 */
export interface PluginScreens {
  /** The plugin manifest's id. */
  readonly id: string;
  readonly routes: readonly ScreenRoute[];
  readonly navigation?: readonly NavigationItem[];
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
}

/** Declare a plugin's screens. Route and target checks run when an application composes them. */
export function definePluginScreens(screens: PluginScreens): PluginScreens {
  return Object.freeze(screens);
}
