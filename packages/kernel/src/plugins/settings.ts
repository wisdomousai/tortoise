import type { ApplicationManifest } from '../manifest';
import type { PluginSetting } from '../plugin-manifest';

/** Plugin settings by plugin id and key, as the launcher supplied them. */
export type PluginSettings = Readonly<Record<string, string>>;

/** Every setting the composed plugins declare. */
export const declaredSettings = (manifest: ApplicationManifest) =>
  (manifest.plugins ?? []).flatMap((plugin) => plugin.settings ?? []);

/**
 * Refuse settings that no composed plugin claims. A policy file passed to an application
 * without the plugin that reads it would otherwise run unenforced while looking configured.
 */
export function assertClaimed(manifest: ApplicationManifest, settings: PluginSettings) {
  const keys = new Set(declaredSettings(manifest).map((setting) => setting.key));
  const unclaimed = Object.keys(settings).filter((key) => !keys.has(key));
  if (unclaimed.length)
    throw new Error(
      `No composed plugin reads the setting${unclaimed.length > 1 ? 's' : ''} ${unclaimed
        .map((key) => `"${key}"`)
        .join(', ')}; refusing to start with configuration that would be ignored`,
    );
}

/** One plugin's own settings. */
export function settingsFor(
  plugin: { readonly settings?: readonly PluginSetting[] },
  settings: PluginSettings,
): PluginSettings {
  const own: Record<string, string> = {};
  for (const { key } of plugin.settings ?? [])
    if (settings[key] !== undefined) own[key] = settings[key];
  return own;
}

/**
 * Merge settings that providers supplied with the launcher's. Provided settings win by default:
 * a device management profile is the operator's decision, and a launcher flag must not quietly
 * override it. `launcherWins` reverses that for development builds, where the developer is the
 * operator. Two providers supplying the same key are a composition error, not something to
 * resolve by order.
 */
export function mergeSettings(
  launcher: PluginSettings,
  provided: readonly { readonly id: string; readonly settings: PluginSettings }[],
  launcherWins = false,
): PluginSettings {
  const merged: Record<string, string> = {};
  const owners = new Map<string, string>();
  for (const { id, settings } of provided)
    for (const [key, value] of Object.entries(settings)) {
      const other = owners.get(key);
      if (other)
        throw new Error(`Plugins "${other}" and "${id}" both provide the setting "${key}"`);
      if (typeof value !== 'string')
        throw new Error(`Plugin "${id}" provided a non-string value for the setting "${key}"`);
      owners.set(key, id);
      merged[key] = value;
    }
  return launcherWins ? { ...merged, ...launcher } : { ...launcher, ...merged };
}
