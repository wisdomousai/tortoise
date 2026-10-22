import type { FeatureScreens } from './feature-screens';

/**
 * What a host plugin contributes to the web frame; the same shape as a feature's screens.
 * Applications pass it to `defineScreens({ plugins })`.
 */
export type PluginScreens = FeatureScreens;

/** Declare a plugin's screens. Route and target checks run when an application composes them. */
export function definePluginScreens(screens: PluginScreens): PluginScreens {
  return Object.freeze(screens);
}
