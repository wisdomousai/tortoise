import type { CapabilityModule, HostComponent } from '@agent-native/contracts';

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
}

const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Declare a plugin manifest. Fails at definition time on an invalid id, key or env name. */
export function definePluginManifest<
  const Modules extends readonly CapabilityModule[] = readonly [],
>(
  manifest: Omit<PluginManifest<Modules>, 'modules'> & { readonly modules?: Modules },
): PluginManifest<Modules> {
  if (!idPattern.test(manifest.id)) throw new Error(`Invalid plugin id "${manifest.id}"`);
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
