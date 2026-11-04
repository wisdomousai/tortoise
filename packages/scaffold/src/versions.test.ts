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
    'node_modules/@tortoise/kernel': { version: '0.2.0' },
    'node_modules/@tortoise/host': { version: '0.2.0' },
    'node_modules/@tortoise/field-notes': { version: '0.1.0', private: true },
  });
  expect(await installedFramework(root)).toEqual({
    versions: { '0.2.0': ['@tortoise/host', '@tortoise/kernel'] },
  });
});

test('a nested copy at another version is refused, wherever the installer put it', async () => {
  const root = await install({
    'node_modules/@tortoise/kernel': { version: '0.2.0' },
    'node_modules/@tortoise/host': { version: '0.1.0' },
    'node_modules/@tortoise/host/node_modules/@tortoise/kernel': { version: '0.1.0' },
    'node_modules/.bun/@tortoise+site@0.3.0/node_modules/@tortoise/site': {
      version: '0.3.0',
    },
  });
  const installed = await installedFramework(root);
  expect(installed.versions).toEqual({
    '0.1.0': ['@tortoise/host', '@tortoise/kernel'],
    '0.2.0': ['@tortoise/kernel'],
    '0.3.0': ['@tortoise/site'],
  });
  expect(installed.problem).toContain('Mixed framework versions installed');
});
