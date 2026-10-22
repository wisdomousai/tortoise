import type { NavigationItem, ScreenRoute } from './screens';

/**
 * What a feature or host plugin contributes to the web frame: its screens, sidebar entries and
 * the screen each of its capability families opens from the palette. Applications pass it to
 * `defineScreens({ features, plugins })`, which places unit navigation after the application's
 * own. Browser-safe and free of `@/` imports so content can import it by package name.
 */
export interface FeatureScreens {
  /** The feature's or plugin's manifest id. */
  readonly id: string;
  readonly routes: readonly ScreenRoute[];
  readonly navigation?: readonly NavigationItem[];
  /** Prefixes start with the unit's operation namespace and a dot, such as `approval.`. */
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
}

/** Declare a feature's screens. Route and target checks run when an application composes them. */
export function defineFeatureScreens(screens: FeatureScreens): FeatureScreens {
  return Object.freeze(screens);
}
