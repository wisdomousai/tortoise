import type { ComponentType, ReactNode } from 'react';
import type { PluginScreens } from './plugin-screens';

/**
 * One routed screen. `path` is relative to the frame root and may hold `$param` segments; read
 * them with `useParams({ strict: false })`, since the route id also names the layout.
 * `layout: 'full'` renders it without the application sidebar and palette, for a station or
 * kiosk screen that owns the whole window; it keeps the session, live invalidation and routing.
 */
export interface ScreenRoute {
  readonly path: string;
  readonly component: () => ReactNode;
  readonly layout?: 'shell' | 'full';
}

/** A sidebar and palette entry pointing at a parameterless screen. */
export interface NavigationItem {
  readonly to: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /**
   * A live count or marker beside the label, for example open rejections. It renders inside the
   * frame's query context, so it reads the same authorized queries as a screen; render nothing
   * when there is nothing to show.
   */
  readonly badge?: ComponentType;
}

/**
 * What an application contributes to the web frame (P11): its screens, navigation, the screen
 * each capability family opens from the palette, and optional sidebar slots. The frame owns
 * routing, session, palette and run panel; it renders whatever this declares.
 */
export interface ApplicationScreens {
  /** The application's name in the sidebar, usually its manifest title. */
  readonly title?: string;
  /** Where `/` redirects. */
  readonly home: string;
  readonly routes: readonly ScreenRoute[];
  readonly navigation: readonly NavigationItem[];
  /** Capability id prefixes and the screen that binds them; the longest matching prefix wins. */
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
  /** Under the title: where and as whom the person works, for example plant and role. */
  readonly context?: ComponentType;
  /** A sidebar section above the navigation for live lists, such as the projects to open. */
  readonly sidebar?: ComponentType;
  /** Rendered in the sidebar footer, for example synchronization state. */
  readonly status?: ComponentType;
  /** Screens of the plugins the manifest lists. `defineScreens` merges them into the above. */
  readonly plugins?: readonly PluginScreens[];
}

/** The application's routes, navigation and capability screens followed by each plugin's. */
function mergePlugins(screens: ApplicationScreens): ApplicationScreens {
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
 * Declare an application's screens. Browser-safe and free of `@/` imports so content can
 * import it by package name. Plugin screens are merged in first, so the checks cover them: fails
 * at definition time on a duplicate route or a navigation or capability target that no route
 * declares, so a typo cannot ship a dead link.
 */
export function defineScreens(declared: ApplicationScreens): ApplicationScreens {
  const screens = mergePlugins(declared);
  const paths = screens.routes.map((route) => route.path.replace(/^\//, ''));
  const duplicate = paths.find((path, index) => paths.indexOf(path) !== index);
  if (duplicate) throw new Error(`Screen route "${duplicate}" is declared twice`);
  const known = new Set(paths.map((path) => `/${path}`));
  for (const to of [
    screens.home,
    ...screens.navigation.map((item) => item.to),
    ...(screens.capabilityScreens ?? []).map((entry) => entry.to),
  ])
    if (!known.has(to)) throw new Error(`Screen target "${to}" has no route`);
  return Object.freeze(screens);
}

/** The screen that binds a capability, by longest matching prefix. */
export function screenForCapability(screens: ApplicationScreens, id: string) {
  return (screens.capabilityScreens ?? [])
    .filter((entry) => id.startsWith(entry.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.to;
}
