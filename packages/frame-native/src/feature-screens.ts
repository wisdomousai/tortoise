import type { NativeNavigationItem, NativeScreenRoute } from './screens';

/**
 * What a feature or host plugin contributes to the native frame: its screens, tabs and the
 * screen each of its capability families opens. Applications pass it to
 * `defineNativeScreens({ features, plugins })`, which places unit tabs after the application's
 * own.
 */
export interface FeatureNativeScreens {
  /** The feature's or plugin's manifest id. */
  readonly id: string;
  readonly routes: readonly NativeScreenRoute[];
  readonly navigation?: readonly NativeNavigationItem[];
  /** Prefixes start with the unit's operation namespace and a dot, such as `approval.`. */
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
}

/** Declare a feature's native screens. Checks run when an application composes them. */
export function defineFeatureNativeScreens(screens: FeatureNativeScreens): FeatureNativeScreens {
  return Object.freeze(screens);
}
