import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readMobileTarget } from '@agent-native/host/mobile-target';
import { writeMobileEntry } from '../../../scripts/mobile-entry';

const root = resolve(import.meta.dir, '../../..');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function scratch(base = tmpdir()) {
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'mobile-entry-'));
  directories.push(directory);
  return directory;
}
function config(fields: Record<string, unknown>) {
  const path = join(scratch(), 'app.config.json');
  const identity = { name: 'starter', displayName: 'Starter', appId: 'dev.example.starter' };
  writeFileSync(path, JSON.stringify({ ...identity, application: '@example/hub', ...fields }));
  return path;
}

test('the mobile target names its own application, or falls back to the starter one', () => {
  expect(readMobileTarget(config({}), {}).application).toBe('@example/hub');
  const field = config({ targets: { mobile: { application: '@example/field' } } });
  expect(readMobileTarget(field, {}).application).toBe('@example/field');
  expect(
    readMobileTarget(field, { AGENT_NATIVE_MOBILE_APPLICATION: '@example/dev' }).application,
  ).toBe('@example/dev');
  // The desktop override does not change what the phone runs.
  expect(readMobileTarget(field, { AGENT_NATIVE_APPLICATION: '@example/dev' }).application).toBe(
    '@example/field',
  );
});

test('misspelled or malformed mobile targets are refused', () => {
  expect(() => readMobileTarget(config({ targets: { mobil: {} } }), {})).toThrow(
    'Unknown targets fields: mobil',
  );
  expect(() => readMobileTarget(config({ targets: { mobile: { app: 'x' } } }), {})).toThrow(
    'Unknown targets.mobile fields: app',
  );
  expect(() => readMobileTarget(config({ targets: { mobile: { application: 3 } } }), {})).toThrow(
    'must name an application',
  );
  expect(() =>
    readMobileTarget(config({ targets: { mobile: { application: 'not a package' } } }), {}),
  ).toThrow('Invalid application specifier');
});

test('the entry imports the application and its native screens by relative path', async () => {
  const directory = scratch(join(root, 'apps/mobile/generated'));
  const { entry, application } = await writeMobileEntry({
    directory,
    env: { AGENT_NATIVE_MOBILE_APPLICATION: './apps/mobile/fixture' },
  });
  expect(application).toBe(join(root, 'apps/mobile/fixture'));
  const source = readFileSync(entry, 'utf8');
  expect(source).toContain('from "../../fixture/application";');
  expect(source).toContain('from "../../fixture/screens-native";');
  expect(source).not.toContain(root);
  // The fixture composes no plugin, so no setting is passed and no OS handler is registered.
  expect(source).toContain('const settings = {};');
  expect(JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'))).toMatchObject({
    plugins: [],
    os: { scheme: 'dev.agentnative.workspace', android: { intentFilters: [] } },
  });
});

test('native.json lists config plugins with the application and every declared setting', async () => {
  // Inside the repository, so the manifest resolves the kernel; git ignores `generated/`.
  const field = scratch(join(root, 'apps/mobile/generated'));
  writeFileSync(
    join(field, 'manifest.ts'),
    [
      "import { defineManifest } from '@agent-native/kernel/manifest';",
      "import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';",
      "const mdm = definePluginManifest({ id: 'mdm', title: 'MDM', platforms: ['android', 'ios'], native: { module: 'Mdm', expoPlugin: '@example/mdm/app.plugin' } });",
      "const scan = definePluginManifest({ id: 'scan', title: 'Scan', platforms: ['android'], native: { module: 'Scan' } });",
      "const link = definePluginManifest({ id: 'link', title: 'Link', platforms: ['android', 'ios'], settings: [{ key: 'hub-url', env: 'HUB_URL', kind: 'string', description: 'Hub origin' }] });",
      "export default defineManifest({ id: 'field', title: 'Field', modules: [], plugins: [mdm, scan, link], targets: ['mobile'], expoPlugins: [{ plugin: 'expo-camera', options: { cameraPermission: 'Photos', recordAudioAndroid: false } }] });",
      '',
    ].join('\n'),
  );
  const directory = scratch();
  await writeMobileEntry({ directory, env: { AGENT_NATIVE_MOBILE_APPLICATION: field } });
  // Only plugins that name a config plugin are listed; a module alone is autolinked. The
  // application's own config plugins follow with their options.
  expect(JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'))).toMatchObject({
    plugins: [
      [
        '@example/mdm/app.plugin',
        {
          application: { id: 'field', title: 'Field' },
          settings: [{ key: 'hub-url', description: 'Hub origin' }],
        },
      ],
      ['expo-camera', { cameraPermission: 'Photos', recordAudioAndroid: false }],
    ],
  });
});

test('OS handlers become native registrations, and the scheme reaches the OS setting', async () => {
  // Inside the repository, so the manifest resolves the kernel; git ignores `generated/`.
  const notes = scratch(join(root, 'apps/mobile/generated'));
  writeFileSync(
    join(notes, 'manifest.ts'),
    [
      "import { z } from 'zod';",
      "import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';",
      "import { defineManifest } from '@agent-native/kernel/manifest';",
      "import { definePluginManifest } from '@agent-native/kernel/plugin-manifest';",
      "const os = definePluginManifest({ id: 'os', title: 'OS', platforms: ['android', 'ios'], settings: [{ key: 'os-scheme', env: 'AGENT_NATIVE_OS_SCHEME', kind: 'string', description: 'Scheme' }] });",
      "const add = defineCapability({ id: 'note.add', kind: 'command', input: jsonSchema(z.strictObject({ text: z.string() })), output: jsonSchema(z.strictObject({})), permission: { action: 'create', resourceType: 'note' }, ui: { binding: 'note.add' } });",
      "const fromText = { id: 'note.from-text', kind: 'file', description: 'A note from text.', types: [{ extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Text' }], role: 'viewer', payload: 'text', maxBytes: 500, target: { prepare: 'note.add', input: { text: '{file.text}' } } } as const;",
      "const link = { id: 'note.open', kind: 'link', description: 'Open a note.', path: '/notes/:id', params: jsonSchema(z.strictObject({ id: z.string() })), verified: true, target: { screen: '/notes', search: { id: '{id}' } } } as const;",
      "export default defineManifest({ id: 'notes', title: 'Notes', modules: [defineModule({ id: 'notes', capabilities: [add], os: { handlers: [link, fromText] } })], plugins: [os], targets: ['mobile'] });",
      '',
    ].join('\n'),
  );
  const directory = scratch();
  const { entry } = await writeMobileEntry({
    configPath: config({}),
    directory,
    env: {
      AGENT_NATIVE_MOBILE_APPLICATION: notes,
      AGENT_NATIVE_OS_LINK_HOSTS: 'notes.example.com',
    },
  });
  expect(readFileSync(entry, 'utf8')).toContain(
    'const settings = {"os-scheme":"dev.example.starter"};',
  );
  const { os } = JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'));
  expect(os.scheme).toBe('dev.example.starter');
  expect(os.android.intentFilters).toEqual([
    {
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'https', host: 'notes.example.com', pathPattern: '/notes/.*' }],
    },
    { action: 'VIEW', category: ['DEFAULT'], data: [{ mimeType: 'text/plain' }] },
  ]);
  expect(os.ios.associatedDomains).toEqual(['applinks:notes.example.com']);
  expect(os.ios.infoPlist.CFBundleDocumentTypes[0].LSItemContentTypes).toEqual([
    'public.plain-text',
  ]);
});

test('an application that does not target mobile is refused', async () => {
  // Inside the repository, so the manifest resolves the kernel; git ignores `generated/`.
  const desktop = scratch(join(root, 'apps/mobile/generated'));
  writeFileSync(
    join(desktop, 'manifest.ts'),
    "import { defineManifest } from '@agent-native/kernel/manifest';\n" +
      "export default defineManifest({ id: 'desk', title: 'Desk', modules: [] });\n",
  );
  await expect(
    writeMobileEntry({ directory: scratch(), env: { AGENT_NATIVE_MOBILE_APPLICATION: desktop } }),
  ).rejects.toThrow("does not target mobile; add 'mobile' to its manifest's targets");
});
