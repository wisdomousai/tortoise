import type { ComponentType, ReactNode } from 'react';

/** One routed screen. `path` is relative to the frame root and may hold `$param` segments. */
export interface ScreenRoute {
  readonly path: string;
  readonly component: () => ReactNode;
}

/** A sidebar and palette entry pointing at a parameterless screen. */
export interface NavigationItem {
  readonly to: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

/**
 * What an application contributes to the web frame (P11): its screens, navigation, the screen
 * each capability family opens from the palette, and an optional sidebar status slot. The frame
 * owns routing, session, palette and run panel; it renders whatever this declares.
 */
export interface ApplicationScreens {
  /** Where `/` redirects. */
  readonly home: string;
  readonly routes: readonly ScreenRoute[];
  readonly navigation: readonly NavigationItem[];
  /** Capability id prefixes and the screen that binds them; the longest matching prefix wins. */
  readonly capabilityScreens?: readonly { readonly prefix: string; readonly to: string }[];
  /** Rendered in the sidebar footer, for example synchronization state. */
  readonly status?: ComponentType;
}

/**
 * Declare an application's screens. Browser-safe and free of `@/` imports so content can
 * import it by package name. Fails at definition time on a duplicate route or a navigation or
 * capability target that no route declares, so a typo cannot ship a dead link.
 */
export function defineScreens(screens: ApplicationScreens): ApplicationScreens {
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
