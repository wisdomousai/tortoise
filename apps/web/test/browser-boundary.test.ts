import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserBoundary } from '../../../scripts/vite-browser-boundary';

const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

/** An application with framework packages installed from a registry, not linked workspaces. */
async function installed() {
  const root = await mkdtemp(join(tmpdir(), 'browser-boundary-'));
  roots.push(root);
  for (const [name, directory] of [
    ['runtime', 'packages/runtime'],
    ['contracts', 'packages/contracts'],
    ['deployment', 'plugins/deployment'],
  ] as const) {
    await mkdir(join(root, 'node_modules/@tortoise', name, 'src'), { recursive: true });
    await writeFile(
      join(root, 'node_modules/@tortoise', name, 'package.json'),
      JSON.stringify({ name: `@tortoise/${name}`, repository: { directory } }),
    );
  }
  return root;
}

test('an installed framework file meets the rule for the directory it was published from', async () => {
  const root = await installed();
  const plugin = browserBoundary(root);
  const load = (id: string) =>
    (plugin.load as (this: unknown, id: string) => unknown).call(
      {
        error: (message: string) => {
          throw new Error(message);
        },
      },
      id,
    );
  const file = (path: string) => join(root, 'node_modules/@tortoise', path);
  expect(() => load(file('runtime/src/runtime.ts'))).toThrow('Browser bundle includes host module');
  expect(() => load(file('deployment/src/plugin.ts'))).toThrow(
    'Browser bundle includes host module',
  );
  expect(load(file('deployment/src/plugin-manifest.ts'))).toBeNull();
  expect(load(file('contracts/src/index.ts'))).toBeNull();
});
