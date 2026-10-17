import type { ApplicationManifest } from '@agent-native/kernel/manifest';
import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { managedConfigPluginManifest } from './plugin-manifest';

/** Managed values by key, as the native module reads them; `null` for a type it cannot express. */
export type ManagedValues = Readonly<Record<string, string | null>>;

/**
 * The settings device management supplies. Every key must be a setting a composed plugin declares
 * and every value text. Anything else refuses startup with the key: a pushed value that nothing
 * reads would look enforced while it is ignored, which is the rule launcher settings follow too.
 */
export function managedSettings(
  values: ManagedValues,
  manifest: Pick<ApplicationManifest, 'plugins'>,
): Readonly<Record<string, string>> {
  const declared = new Set(
    (manifest.plugins ?? []).flatMap((plugin) => plugin.settings ?? []).map(({ key }) => key),
  );
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!declared.has(key))
      throw new Error(`Managed configuration sets "${key}", which no composed plugin reads`);
    if (typeof value !== 'string')
      throw new Error(`Managed configuration sets "${key}" to a value that is not text`);
    settings[key] = value;
  }
  return settings;
}

/**
 * The plugin over a reader of the device's managed values. It is a settings provider: it runs
 * before any plugin opens, and what it returns wins over the launcher's settings except in
 * development builds (`launcherSettingsWin`). It reads once, at startup; a change pushed later
 * applies on the next start.
 */
export function createManagedConfigPlugin(read: () => ManagedValues) {
  return defineHostPlugin({
    manifest: managedConfigPluginManifest,
    async provideSettings({ manifest }) {
      return managedSettings(read(), manifest);
    },
  });
}
