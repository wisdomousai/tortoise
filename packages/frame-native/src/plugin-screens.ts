import type { FeatureNativeScreens } from './feature-screens';

/**
 * What a host plugin contributes to the native frame; the same shape as a feature's native
 * screens. Applications pass it to `defineNativeScreens({ plugins })`.
 */
export type PluginNativeScreens = FeatureNativeScreens;

/** Declare a plugin's native screens. Checks run when an application composes them. */
export function definePluginNativeScreens(screens: PluginNativeScreens): PluginNativeScreens {
  return Object.freeze(screens);
}
