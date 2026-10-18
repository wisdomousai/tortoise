import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBlobStore } from '@agent-native/adapters/blob-files';
import { bunSqlDriver } from '@agent-native/adapters/sqlite';
import { defineApplication } from '@agent-native/kernel/application';
import { defineManifest } from '@agent-native/kernel/manifest';
import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';
import { createMobilePlatform, openMobileInstance } from '@agent-native/mobile';
import { createManagedConfigPlugin, type ManagedValues } from '../src/managed-config';
import { managedConfigPluginManifest } from '../src/plugin-manifest';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function platform() {
  const sandbox = mkdtempSync(join(tmpdir(), 'managed-'));
  directories.push(sandbox);
  return createMobilePlatform({
    id: 'android',
    openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
    openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
  });
}

/** A plugin that declares the hub address and reports what it was opened with. */
const linkManifest = definePluginManifest({
  id: 'link',
  title: 'Link',
  platforms: ['android', 'ios'],
  settings: [{ key: 'hub-url', env: 'HUB_URL', kind: 'string', description: 'Hub origin' }],
});
function field(values: ManagedValues, seen: Record<string, string>[]) {
  const link = defineHostPlugin({
    manifest: linkManifest,
    async open({ settings }) {
      seen.push({ ...settings });
      return {};
    },
  });
  const managed = createManagedConfigPlugin(() => values);
  return defineApplication({
    manifest: defineManifest({
      id: 'field',
      title: 'Field',
      modules: [],
      plugins: [managedConfigPluginManifest, linkManifest],
      targets: ['mobile'],
    }),
    plugins: [managed, link],
    createState: () => ({}),
    handlers: [],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
  });
}

test('managed values become settings and win over the launcher outside development builds', async () => {
  const seen: Record<string, string>[] = [];
  const managed = { 'hub-url': 'https://hub.site.example' };
  const options = { platform: platform(), settings: { 'hub-url': 'https://launcher.example' } };
  await (await openMobileInstance(field(managed, seen), options)).close();
  await (
    await openMobileInstance(field(managed, seen), { ...options, launcherSettingsWin: true })
  ).close();
  expect(seen).toEqual([
    { 'hub-url': 'https://hub.site.example' },
    { 'hub-url': 'https://launcher.example' },
  ]);
});

test('a managed key nothing reads, or a value that is not text, refuses startup', async () => {
  await expect(
    openMobileInstance(field({ 'hub-adress': 'https://typo.example' }, []), {
      platform: platform(),
    }),
  ).rejects.toThrow('Managed configuration sets "hub-adress", which no composed plugin reads');
  await expect(
    openMobileInstance(field({ 'hub-url': null }, []), { platform: platform() }),
  ).rejects.toThrow('Managed configuration sets "hub-url" to a value that is not text');
});

test('the Android restrictions schema declares every composed setting', () => {
  const { restrictionsXml } = createRequire(import.meta.url)('../app.plugin.js') as {
    restrictionsXml(settings: readonly { key: string; description: string }[]): string;
  };
  const xml = restrictionsXml([
    { key: 'hub-url', description: 'Hub origin' },
    { key: 'site-policy', description: 'Policy "A" & <B>' },
  ]);
  expect(xml).toContain(
    '<restriction android:key="hub-url" android:title="hub-url" android:description="Hub origin" android:restrictionType="string" />',
  );
  expect(xml).toContain('android:description="Policy &quot;A&quot; &amp; &lt;B&gt;"');
});
