import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedFramework } from './versions';

const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function install(packages: Record<string, { version: string; private?: boolean }>) {
  const root = await mkdtemp(join(tmpdir(), 'framework-versions-'));
  roots.push(root);
  for (const [path, manifest] of Object.entries(packages)) {
    await mkdir(join(root, path), { recursive: true });
    const name = path.split('node_modules/').at(-1)!;
    await writeFile(join(root, path, 'package.json'), JSON.stringify({ name, ...manifest }));
  }
  return root;
}

test('one framework version passes and private workspaces are not counted', async () => {
  const root = await install({
    'node_modules/@agent-native/kernel': { version: '0.2.0' },
    'node_modules/@agent-native/host': { version: '0.2.0' },
    'node_modules/@agent-native/field-notes': { version: '0.1.0', private: true },
  });
  expect(await installedFramework(root)).toEqual({
    versions: { '0.2.0': ['@agent-native/host', '@agent-native/kernel'] },
  });
});

test('a nested copy at another version is refused, wherever the installer put it', async () => {
  const root = await install({
    'node_modules/@agent-native/kernel': { version: '0.2.0' },
    'node_modules/@agent-native/host': { version: '0.1.0' },
    'node_modules/@agent-native/host/node_modules/@agent-native/kernel': { version: '0.1.0' },
    'node_modules/.bun/@agent-native+site@0.3.0/node_modules/@agent-native/site': {
      version: '0.3.0',
    },
  });
  const installed = await installedFramework(root);
  expect(installed.versions).toEqual({
    '0.1.0': ['@agent-native/host', '@agent-native/kernel'],
    '0.2.0': ['@agent-native/kernel'],
    '0.3.0': ['@agent-native/site'],
  });
  expect(installed.problem).toContain('Mixed framework versions installed');
});
