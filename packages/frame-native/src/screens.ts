import type { ComponentType } from 'react';
import type { PluginNativeScreens } from './plugin-screens';

/**
 * One screen of the native frame. `path` names it the way the web frame names a route (`/captures`,
 * `/captures/detail`), so navigation and capability targets read the same on both. React
 * Navigation passes parameters as route params, not path segments; read them with `useRoute()`.
 * `title` is the header text; without one the screen renders without a header.
 */
export interface NativeScreenRoute {
  readonly path: string;
  readonly component: ComponentType;
  readonly title?: string;
}

/** A tab on phones and a rail entry on tablets, pointing at a screen that takes no params. */
export interface NativeNavigationItem {
  readonly to: string;
  readonly label: string;
  readonly icon: ComponentType<{ size?: number; color?: string }>;
}

/**
 * What an application contributes to the native frame: its screens, the tabs, the screen each
 * capability family opens, and a status slot. The frame owns navigation, the session context and
 * live invalidation; it renders whatever this declares.
 */
export interface NativeApplicationScreens {
  readonly title?: string;
  /** The tab the app opens on. It must also be a navigation target. */
  readonly home: string;
  readonly routes: readonly NativeScreenRoute[];
  readonly navigation: readonly NativeNavigationItem[];
  /** Capability id prefixes and the screen that binds them; the longest matching prefix wins. */
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
  /** Rendered above every screen, for example synchronization state. */
  readonly status?: ComponentType;
  /** Screens of the plugins the manifest lists. `defineNativeScreens` merges them into the above. */
  readonly plugins?: readonly PluginNativeScreens[];
}

function mergePlugins(screens: NativeApplicationScreens): NativeApplicationScreens {
  const plugins = screens.plugins ?? [];
  if (!plugins.length) return screens;
  return {
    ...screens,
    routes: [...screens.routes, ...plugins.flatMap((plugin) => plugin.routes)],
    navigation: [...screens.navigation, ...plugins.flatMap((plugin) => plugin.navigation ?? [])],
    capabilityScreens: [
      ...(screens.capabilityScreens ?? []),
      ...plugins.flatMap((plugin) => plugin.capabilityScreens ?? []),
    ],
  };
}

/**
 * Declare an application's native screens. Free of React Native imports, so Bun tests and the
 * build step can load it. Plugin screens are merged first, so the checks cover them: fails at
 * definition time on a duplicate path, a navigation or capability target that no screen declares,
 * a home that is not a tab, or a tab declared twice.
 */
export function defineNativeScreens(declared: NativeApplicationScreens): NativeApplicationScreens {
  const screens = mergePlugins(declared);
  const paths = screens.routes.map((route) => route.path);
  const duplicate = paths.find((path, index) => paths.indexOf(path) !== index);
  if (duplicate) throw new Error(`Screen "${duplicate}" is declared twice`);
  const known = new Set(paths);
  for (const to of [
    screens.home,
    ...screens.navigation.map((item) => item.to),
    ...(screens.capabilityScreens ?? []).map((entry) => entry.to),
  ])
    if (!known.has(to)) throw new Error(`Screen target "${to}" has no screen`);
  const tabs = screens.navigation.map((item) => item.to);
  const twice = tabs.find((to, index) => tabs.indexOf(to) !== index);
  if (twice) throw new Error(`Screen "${twice}" is a tab twice`);
  if (!tabs.includes(screens.home)) throw new Error(`Home "${screens.home}" is not a tab`);
  return Object.freeze(screens);
}

/** The screen that binds a capability, by longest matching prefix. */
export function nativeScreenForCapability(screens: NativeApplicationScreens, id: string) {
  return (screens.capabilityScreens ?? [])
    .filter((entry) => id.startsWith(entry.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.to;
}
