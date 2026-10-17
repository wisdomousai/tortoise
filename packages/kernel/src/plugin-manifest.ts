import type { CapabilityModule, HostComponent } from '@agent-native/contracts';

/** The JavaScript hosts an authority runs on: Bun on desktops and servers, Hermes on phones. */
export type PlatformId = 'bun' | 'android' | 'ios';
export const platformIds: readonly PlatformId[] = ['bun', 'android', 'ios'];

/**
 * One trusted launcher input a plugin reads, such as a policy file or a log directory. The CLI
 * reads it from `--<key>`, the service from `env`. A `path` resolves against the working
 * directory. Settings are host configuration, never caller input.
 */
export interface PluginSetting {
  /** Lowercase key; also the CLI flag name. */
  readonly key: string;
  readonly env: string;
  readonly kind: 'path' | 'string';
  readonly description: string;
}

/**
 * The browser-safe part of a host plugin: its id and what it adds to the composed catalog.
 * Applications list it in `defineManifest({ plugins })`, which merges its modules and components
 * into the manifest, so generators, the UI-binding check and the frame see plugin operations and
 * requirements exactly like the application's own. Pure data, no host code.
 */
export interface PluginManifest<
  Modules extends readonly CapabilityModule[] = readonly CapabilityModule[],
> {
  /** Lowercase id. Also the key of the plugin's state slice and services. */
  readonly id: string;
  readonly title: string;
  readonly modules: Modules;
  /** Network destinations, devices and processes the plugin itself needs. */
  readonly components?: readonly HostComponent[];
  readonly settings?: readonly PluginSetting[];
  /**
   * Platforms the plugin's server part runs on. Absent means Bun only, which is what every plugin
   * written before other platforms existed assumes. The kernel refuses to open a plugin on a
   * platform it does not list.
   */
  readonly platforms?: readonly PlatformId[];
  /** Native code the plugin brings to Android and iOS builds; see `PluginNative`. */
  readonly native?: PluginNative;
}

/**
 * Native code in a plugin package: an Expo module (`expo-module.config.json` with `android/` or
 * `ios/`), which Expo autolinking links into every build, and an Expo config plugin for what the
 * build must declare, such as an Android managed-configuration schema. Pure data: `mobile:prepare`
 * lists the config plugins of the composed plugins for `expo prebuild`, and the plugin's own
 * `open` refuses to start when its module is missing from the running build.
 */
export interface PluginNative {
  /**
   * The config plugin as a module specifier resolved from the app, for example
   * `@agent-native/managed-config/app.plugin`. Expo runs it at prebuild with
   * `{ application, settings }`: the application's id and title and every setting the composed
   * plugins declare.
   */
  readonly expoPlugin?: string;
  /** The Expo module's name, as `requireNativeModule` looks it up. */
  readonly module?: string;
}

const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** A package module specifier such as `@scope/package/app.plugin`, for Expo config plugins. */
export const moduleSpecifierPattern = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/;

function checkNative(manifest: Pick<PluginManifest, 'id' | 'platforms' | 'native'>) {
  const { native } = manifest;
  if (!native) return;
  if (!manifest.platforms?.some((platform) => platform === 'android' || platform === 'ios'))
    throw new Error(`Plugin "${manifest.id}" brings native code but lists neither android nor ios`);
  if (native.expoPlugin !== undefined && !moduleSpecifierPattern.test(native.expoPlugin))
    throw new Error(`Plugin "${manifest.id}" has an invalid Expo config plugin specifier`);
  if (native.module !== undefined && !/^[A-Za-z][A-Za-z0-9]*$/.test(native.module))
    throw new Error(`Plugin "${manifest.id}" has an invalid native module name`);
}

/**
 * Declare a plugin manifest. Fails at definition time on an invalid id, key, env name or platform,
 * and on native code in a plugin that runs on neither Android nor iOS.
 */
export function definePluginManifest<
  const Modules extends readonly CapabilityModule[] = readonly [],
>(
  manifest: Omit<PluginManifest<Modules>, 'modules'> & { readonly modules?: Modules },
): PluginManifest<Modules> {
  if (!idPattern.test(manifest.id)) throw new Error(`Invalid plugin id "${manifest.id}"`);
  for (const platform of manifest.platforms ?? [])
    if (!platformIds.includes(platform))
      throw new Error(`Plugin "${manifest.id}" names an unknown platform "${platform}"`);
  if (manifest.platforms && !manifest.platforms.length)
    throw new Error(`Plugin "${manifest.id}" lists no platform`);
  checkNative(manifest);
  for (const setting of manifest.settings ?? []) {
    if (!idPattern.test(setting.key))
      throw new Error(`Plugin "${manifest.id}" has an invalid setting key "${setting.key}"`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(setting.env))
      throw new Error(`Plugin "${manifest.id}" has an invalid setting env "${setting.env}"`);
  }
  return Object.freeze({ ...manifest, modules: manifest.modules ?? ([] as unknown as Modules) });
}

/** Every module a list of plugin manifests contributes, as one union for typed clients. */
export type PluginModules<Plugins extends readonly PluginManifest[]> =
  Plugins[number]['modules'][number];
