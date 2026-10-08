import { resolve } from 'node:path';
import { takeFlag } from '@agent-native/adapters/cli';
import type { ApplicationManifest } from '../manifest';
import type { PluginSetting } from '../plugin-manifest';

/** Plugin settings by plugin id and key, as the launcher supplied them. */
export type PluginSettings = Readonly<Record<string, string>>;

const declared = (manifest: ApplicationManifest) =>
  (manifest.plugins ?? []).flatMap((plugin) => plugin.settings ?? []);

const valueOf = (setting: PluginSetting, raw: string) =>
  setting.kind === 'path' ? resolve(raw) : raw;

/**
 * Read every declared plugin setting from `--<key>` (taken out of `args`) or else its env
 * variable. Both are trusted launcher inputs. A flag no plugin declares is left in `args`, so
 * the command's `rejectRemaining` refuses it rather than ignore it.
 */
export function readPluginSettings(
  manifest: ApplicationManifest,
  env: Record<string, string | undefined>,
  args: string[] = [],
): PluginSettings {
  const settings: Record<string, string> = {};
  for (const setting of declared(manifest)) {
    const raw = takeFlag(args, setting.key) ?? env[setting.env];
    if (raw) settings[setting.key] = valueOf(setting, raw);
  }
  return settings;
}

/**
 * Refuse settings that no composed plugin claims. A policy file passed to an application
 * without the plugin that reads it would otherwise run unenforced while looking configured.
 */
export function assertClaimed(manifest: ApplicationManifest, settings: PluginSettings) {
  const keys = new Set(declared(manifest).map((setting) => setting.key));
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

/** Usage lines for the declared settings, for `help`. */
export function settingsUsage(manifest: ApplicationManifest) {
  return declared(manifest)
    .map(
      (setting) =>
        `  --${setting.key} ${setting.kind === 'path' ? 'path' : 'value'}   ${setting.description} (${setting.env})`,
    )
    .join('\n');
}
