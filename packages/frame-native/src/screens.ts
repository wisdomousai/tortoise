import type { ComponentType } from 'react';
import { checkUnitScreens, type UnitsManifest } from '@tortoise/contracts';
import type { FeatureNativeScreens } from './feature-screens';
import type { PluginNativeScreens } from './plugin-screens';
import type { NativeSession } from './session';

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
  /**
   * The screen that shows each selectable resource kind, for an OS link that opens
   * `kind:id`. A kind without an entry cannot be opened that way. It may read through the
   * session, for example a task's project; the screen must be one this declares.
   */
  readonly resources?: Readonly<
    Record<
      string,
      (
        id: string,
        session: NativeSession,
      ) =>
        | { readonly to: string; readonly params?: Record<string, unknown> }
        | Promise<{ readonly to: string; readonly params?: Record<string, unknown> }>
    >
  >;
  /** Rendered above every screen, for example synchronization state. */
  readonly status?: ComponentType;
  /** Screens of the features the manifest lists. `defineNativeScreens` merges them into the above. */
  readonly features?: readonly FeatureNativeScreens[];
  /** Screens of the plugins the manifest lists. `defineNativeScreens` merges them into the above. */
  readonly plugins?: readonly PluginNativeScreens[];
  /**
   * The application's manifest; required with feature or plugin screens, which
   * `defineNativeScreens` checks against the units it composes. Only their ids and namespaces are
   * read.
   */
  readonly manifest?: UnitsManifest;
}

/** The application's screens, tabs and capability screens, then each feature's and plugin's. */
function mergeUnits(screens: NativeApplicationScreens): NativeApplicationScreens {
  const units = [...(screens.features ?? []), ...(screens.plugins ?? [])];
  if (!units.length) return screens;
  return {
    ...screens,
    routes: [...screens.routes, ...units.flatMap((unit) => unit.routes)],
    navigation: [...screens.navigation, ...units.flatMap((unit) => unit.navigation ?? [])],
    capabilityScreens: [
      ...(screens.capabilityScreens ?? []),
      ...units.flatMap((unit) => unit.capabilityScreens ?? []),
    ],
  };
}

/**
 * Declare an application's native screens. Free of React Native imports, so Bun tests and the
 * build step can load it. Feature and plugin screens are merged first, so the checks cover them:
 * fails at definition time on a duplicate path, a navigation or capability target that no screen
 * declares, a home that is not a tab, or a tab declared twice. It also fails on feature or plugin
 * screens the manifest does not compose, out of its order, or opening another unit's capabilities.
 */
export function defineNativeScreens(declared: NativeApplicationScreens): NativeApplicationScreens {
  checkUnitScreens(declared);
  const screens = mergeUnits(declared);
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
