import type { CapabilityModule, HostComponent } from '@agent-native/contracts';
import {
  moduleSpecifierPattern,
  type PlatformId,
  type PluginManifest,
  type PluginModules,
} from './plugin-manifest';

/** Where an application is delivered: the desktop window, a browser, or the mobile app. */
export type ApplicationTarget = 'desktop' | 'web' | 'mobile';
/** The platforms that host an authority for each target. */
export const targetPlatforms: Readonly<Record<ApplicationTarget, readonly PlatformId[]>> = {
  desktop: ['bun'],
  web: ['bun'],
  mobile: ['android', 'ios'],
};

/**
 * The browser-safe identity of one application: a stable id, a title and the capability modules
 * it composes. Generators, the UI-binding check and the web frame read it without loading
 * handlers, storage, services or provider code, so this file must stay import-free of host code.
 */
export interface ApplicationManifest<
  Modules extends readonly CapabilityModule[] = readonly CapabilityModule[],
> {
  /** Lowercase id; names the generated reference directory, the web build and the dev workspace. */
  readonly id: string;
  /** Human title shown by the frame when the starter's identity does not override it. */
  readonly title: string;
  /** The application's modules followed by its plugins' modules (see `defineManifest`). */
  readonly modules: Modules;
  /**
   * Non-module parts this application brings, such as a screen bridge or device drivers, with
   * the network destinations, devices and processes they need. The host adds its own; the
   * composed requirements are what a site policy binds. Pure data. Includes the plugins'.
   */
  readonly components?: readonly HostComponent[];
  /** Plugins composed into this application, in the order the host opens them. */
  readonly plugins?: readonly PluginManifest[];
  /**
   * Where the application is delivered. Absent means desktop and web, the targets that existed
   * before mobile. Build tooling reads it; the kernel checks that every plugin runs there.
   */
  readonly targets?: readonly ApplicationTarget[];
  /**
   * Expo config plugins of native libraries the application's own screens use, such as
   * `expo-camera` with its permission text. `mobile:prepare` lists them after the composed
   * plugins' config plugins. Only for an application that targets mobile. Pure data.
   */
  readonly expoPlugins?: readonly ExpoPluginEntry[];
}

/** One Expo config plugin by module specifier, with the options Expo passes it at prebuild. */
export interface ExpoPluginEntry {
  readonly plugin: string;
  readonly options?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Declare an application manifest. Plugin modules and components are merged in after the
 * application's own, so every consumer of `modules` and `components` sees the whole catalog and
 * none has to know plugins exist. Literal module types are preserved for typed clients.
 * Fails at definition time on an invalid id, a module listed twice (including across plugins),
 * a plugin listed twice, an unknown target, a plugin that runs on no platform of a target, or an
 * Expo config plugin on an application that does not target mobile.
 */
export function defineManifest<
  const Modules extends readonly CapabilityModule[],
  const Plugins extends readonly PluginManifest[] = readonly [],
>(
  manifest: Omit<ApplicationManifest<Modules>, 'plugins'> & { readonly plugins?: Plugins },
): ApplicationManifest<readonly (Modules[number] | PluginModules<Plugins>)[]> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.id))
    throw new Error(`Invalid application id "${manifest.id}"`);
  const plugins: readonly PluginManifest[] = manifest.plugins ?? [];
  const pluginIds = plugins.map((plugin) => plugin.id);
  const twice = pluginIds.find((id, index) => pluginIds.indexOf(id) !== index);
  if (twice) throw new Error(`Plugin "${twice}" is composed twice`);
  checkTargets(manifest.targets, plugins);
  checkExpoPlugins(manifest);
  const modules = [...manifest.modules, ...plugins.flatMap((plugin) => plugin.modules)];
  const ids = modules.map((module) => module.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Module "${duplicate}" is composed twice`);
  const components = [
    ...(manifest.components ?? []),
    ...plugins.flatMap((plugin) => plugin.components ?? []),
  ];
  return Object.freeze({
    ...manifest,
    modules,
    ...(components.length ? { components } : {}),
    ...(plugins.length ? { plugins } : {}),
  });
}

/**
 * Every declared target must be known, and every plugin must run on at least one platform of
 * each target. A plugin may support only some platforms of a target (Android but not iOS); the
 * kernel then refuses to open it on the others, so the gap shows at startup, not silently.
 */
function checkTargets(
  targets: readonly ApplicationTarget[] | undefined,
  plugins: readonly PluginManifest[],
) {
  for (const target of targets ?? []) {
    if (!Object.hasOwn(targetPlatforms, target))
      throw new Error(`Unknown application target "${target}"`);
    const platforms = targetPlatforms[target];
    for (const plugin of plugins) {
      const supported = plugin.platforms ?? ['bun'];
      if (!platforms.some((platform) => supported.includes(platform)))
        throw new Error(`Plugin "${plugin.id}" does not run on target "${target}"`);
    }
  }
  const twice = (targets ?? []).find((target, index) => targets!.indexOf(target) !== index);
  if (twice) throw new Error(`Target "${twice}" is listed twice`);
}

function checkExpoPlugins(manifest: Pick<ApplicationManifest, 'id' | 'targets' | 'expoPlugins'>) {
  if (!manifest.expoPlugins?.length) return;
  if (!manifest.targets?.includes('mobile'))
    throw new Error(
      `Application "${manifest.id}" lists Expo config plugins but does not target mobile`,
    );
  for (const { plugin } of manifest.expoPlugins)
    if (!moduleSpecifierPattern.test(plugin))
      throw new Error(`Application "${manifest.id}" has an invalid Expo config plugin "${plugin}"`);
}
