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
