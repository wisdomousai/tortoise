import type { PluginManifest } from '@tortoise/kernel/plugin-manifest';

/** Looks a native module up by name; `null` when the build does not include it. */
export type NativeModuleLookup = <Module>(name: string) => Module | null;

/**
 * The native module a plugin's manifest names in `native.module`, through `lookup`. A plugin
 * calls it while opening, so a build made without the plugin's native code (`expo prebuild` not
 * rerun after adding the plugin) refuses startup with the reason instead of failing at the first
 * call. Throws when the manifest names no module or the build lacks it.
 */
export function requirePluginNativeModule<Module>(
  manifest: PluginManifest,
  lookup: NativeModuleLookup,
): Module {
  const name = manifest.native?.module;
  if (!name) throw new Error(`Plugin "${manifest.id}" declares no native module`);
  const module = lookup<Module>(name);
  if (!module)
    throw new Error(
      `Plugin "${manifest.id}" needs the native module "${name}", which this build does not include; run bun run mobile:prebuild and rebuild`,
    );
  return module;
}
