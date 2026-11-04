import { resolve } from 'node:path';
import { takeFlag } from '@tortoise/adapters/cli';
import type { ApplicationManifest } from '@tortoise/kernel/manifest';
import type { PluginSetting } from '@tortoise/kernel/plugin-manifest';
import {
  declaredSettings as declared,
  type PluginSettings,
} from '@tortoise/kernel/plugins/settings';

export { assertClaimed, settingsFor, type PluginSettings } from '@tortoise/kernel/plugins/settings';

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

/** Usage lines for the declared settings, for `help`. */
export function settingsUsage(manifest: ApplicationManifest) {
  return declared(manifest)
    .map(
      (setting) =>
        `  --${setting.key} ${setting.kind === 'path' ? 'path' : 'value'}   ${setting.description} (${setting.env})`,
    )
    .join('\n');
}
