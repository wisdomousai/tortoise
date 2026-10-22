import type { ComponentType, ReactNode } from 'react';
import { checkUnitScreens, type UnitsManifest } from '@agent-native/contracts';
import type { FeatureScreens } from './feature-screens';
import type { PluginScreens } from './plugin-screens';

/**
 * One routed screen. `path` is relative to the frame root and may hold `$param` segments; read
 * them with `useParams({ strict: false })`, since the route id also names the layout.
 * `layout: 'full'` renders it without the application sidebar and palette, for a station or
 * kiosk screen that owns the whole window; it keeps the session, live invalidation and routing.
 * `compact` replaces `component` on a narrow viewport (a phone, or a tablet in portrait or in a
 * hub's web view); it binds the same capabilities, laid out for touch and one column.
 */
export interface ScreenRoute {
  readonly path: string;
  readonly component: () => ReactNode;
  readonly compact?: () => ReactNode;
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
 * What an application contributes to the web frame: its screens, navigation, the screen
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
  /**
   * The screen path that shows a selectable resource, by kind, for an OS link or file that opens
   * `kind:id`. A kind without an entry cannot be opened that way. Runs in the frame's query
   * context, so it may read an authorized query, such as a task's project.
   */
  readonly resources?: Readonly<Record<string, (id: string) => string | Promise<string>>>;
  /** Capability id prefixes and the screen that binds them; the longest matching prefix wins. */
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
  /** Under the title: where and as whom the person works, for example plant and role. */
  readonly context?: ComponentType;
  /** A sidebar section above the navigation for live lists, such as the projects to open. */
  readonly sidebar?: ComponentType;
  /** Rendered in the sidebar footer, for example synchronization state. */
  readonly status?: ComponentType;
  /** Screens of the features the manifest lists. `defineScreens` merges them into the above. */
  readonly features?: readonly FeatureScreens[];
  /** Screens of the plugins the manifest lists. `defineScreens` merges them into the above. */
  readonly plugins?: readonly PluginScreens[];
  /**
   * The application's manifest; required with feature or plugin screens, which `defineScreens`
   * checks against the units it composes. Only their ids and namespaces are read.
   */
  readonly manifest?: UnitsManifest;
}

/** The application's routes, navigation and capability screens, then each feature's and plugin's. */
function mergeUnits(screens: ApplicationScreens): ApplicationScreens {
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
 * Declare an application's screens. Browser-safe and free of `@/` imports so content can
 * import it by package name. Feature and plugin screens are merged in first, so the checks cover
 * them: fails at definition time on a duplicate route or a navigation or capability target that
 * no route declares, so a typo cannot ship a dead link. It also fails on feature or plugin screens
 * the manifest does not compose, out of its order, or opening another unit's capabilities.
 */
export function defineScreens(declared: ApplicationScreens): ApplicationScreens {
  checkUnitScreens(declared);
  const screens = mergeUnits(declared);
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
