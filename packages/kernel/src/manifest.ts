import {
  operationNamespace,
  type CapabilityModule,
  type FeatureManifest,
  type FeatureModules,
  type HostComponent,
} from '@tortoise/contracts';
import {
  moduleSpecifierPattern,
  pluginNamespace,
  type PlatformId,
  type PluginManifest,
  type PluginModules,
} from './plugin-manifest';

/** Where an application is delivered: the desktop window, a browser, or the mobile app. */
export type ApplicationTarget = 'desktop' | 'web' | 'mobile';
/** The platforms that host an instance for each target. */
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
  /** The application's modules, then its features', then its plugins' (see `defineManifest`). */
  readonly modules: Modules;
  /**
   * Non-module parts this application brings, such as a screen bridge or device drivers, with
   * the network destinations, devices and processes they need. The host adds its own; the
   * composed requirements are what a deployment policy binds. Pure data. Includes the plugins'.
   */
  readonly components?: readonly HostComponent[];
  /** Features mounted into this application, in the order their slices are composed. */
  readonly features?: readonly FeatureManifest[];
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
  /**
   * Days a build of the application is expected to serve its task. Each build's best-before date
   * is its build date plus this; hosts, `app status`, compliance posture and the fleet show it, and
   * nothing is refused after it. Absent: builds carry no best-before date.
   */
  readonly shelfLifeDays?: number;
}

/** One Expo config plugin by module specifier, with the options Expo passes it at prebuild. */
export interface ExpoPluginEntry {
  readonly plugin: string;
  readonly options?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Declare an application manifest. Feature and plugin modules and components are merged in after
 * the application's own, so every consumer of `modules` and `components` sees the whole catalog
 * and none has to know features or plugins exist. Literal module types are preserved for typed
 * clients. Fails at definition time on an invalid id, a module listed twice, a feature or plugin
 * listed twice or sharing an id or namespace, a feature required before it is mounted, an
 * application operation inside a feature's or plugin's namespace, an unknown target, a plugin
 * that runs on no platform of a target, or an Expo config plugin on an application that does
 * not target mobile.
 */
export function defineManifest<
  const Modules extends readonly CapabilityModule[],
  const Features extends readonly FeatureManifest[] = readonly [],
  const Plugins extends readonly PluginManifest[] = readonly [],
>(
  manifest: Omit<ApplicationManifest<Modules>, 'plugins' | 'features'> & {
    readonly features?: Features;
    readonly plugins?: Plugins;
  },
): ApplicationManifest<
  readonly (Modules[number] | FeatureModules<Features> | PluginModules<Plugins>)[]
> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.id))
    throw new Error(`Invalid application id "${manifest.id}"`);
  const { shelfLifeDays } = manifest;
  if (shelfLifeDays !== undefined && !(Number.isSafeInteger(shelfLifeDays) && shelfLifeDays > 0))
    throw new Error(`Shelf life of "${manifest.id}" must be a positive whole number of days`);
  const features: readonly FeatureManifest[] = manifest.features ?? [];
  const plugins: readonly PluginManifest[] = manifest.plugins ?? [];
  checkUnitIds(features, plugins);
  const units = [...features, ...plugins];
  const modules = [...manifest.modules, ...units.flatMap((unit) => unit.modules)];
  const ids = modules.map((module) => module.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Module "${duplicate}" is composed twice`);
  checkUnitManifests(manifest.modules, features, plugins);
  checkTargets(manifest.targets, plugins);
  checkExpoPlugins(manifest);
  const components = [
    ...(manifest.components ?? []),
    ...units.flatMap((unit) => unit.components ?? []),
  ];
  return Object.freeze({
    ...manifest,
    modules,
    ...(components.length ? { components } : {}),
    ...(features.length ? { features } : {}),
    ...(plugins.length ? { plugins } : {}),
  });
}

/** Features and plugins share one id space: state keys, stamps and services keys. */
function checkUnitIds(features: readonly FeatureManifest[], plugins: readonly PluginManifest[]) {
  const twice = (ids: readonly string[]) => ids.find((id, index) => ids.indexOf(id) !== index);
  const feature = twice(features.map((unit) => unit.id));
  if (feature) throw new Error(`Feature "${feature}" is mounted twice`);
  const plugin = twice(plugins.map((unit) => unit.id));
  if (plugin) throw new Error(`Plugin "${plugin}" is composed twice`);
  const shared = features.find((unit) => plugins.some((other) => other.id === unit.id));
  if (shared) throw new Error(`Feature and plugin "${shared.id}" share an id`);
}

/**
 * A feature or plugin that declares operations owns its namespace: no other unit shares it, and
 * the application's own operations stay out of it. A unit without operations claims none, so a
 * plugin such as `deployment` leaves `deployment.*` to the application.
 */
function checkUnitManifests(
  own: readonly CapabilityModule[],
  features: readonly FeatureManifest[],
  plugins: readonly PluginManifest[],
) {
  const namespaces = new Map<string, string>();
  const operating = (unit: FeatureManifest) =>
    unit.modules.some((module) => module.capabilities.length > 0);
  for (const [unit, namespace] of [
    ...features.filter(operating).map((feature) => [feature.id, feature.id] as const),
    ...plugins.filter(operating).map((plugin) => [plugin.id, pluginNamespace(plugin)] as const),
  ]) {
    const owner = namespaces.get(namespace);
    if (owner)
      throw new Error(`"${unit}" and "${owner}" share the operation namespace "${namespace}"`);
    namespaces.set(namespace, unit);
  }
  for (const [index, feature] of features.entries())
    for (const required of feature.requires ?? [])
      if (!features.slice(0, index).some((earlier) => earlier.id === required))
        throw new Error(`Feature "${feature.id}" requires "${required}" mounted before it`);
  for (const module of own)
    for (const capability of module.capabilities) {
      const owner = namespaces.get(operationNamespace(capability.id));
      if (owner)
        throw new Error(`Application operation ${capability.id} is in the namespace of "${owner}"`);
    }
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
