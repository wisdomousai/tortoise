import type { CapabilityModule, HostComponent } from '@agent-native/contracts';
import type { PluginManifest, PluginModules } from './plugin-manifest';

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
}

/**
 * Declare an application manifest. Plugin modules and components are merged in after the
 * application's own, so every consumer of `modules` and `components` sees the whole catalog and
 * none has to know plugins exist. Literal module types are preserved for typed clients.
 * Fails at definition time on an invalid id, a module listed twice (including across plugins)
 * or a plugin listed twice.
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
