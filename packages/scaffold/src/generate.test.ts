import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorkspace } from './content';
import { insertAtMarker } from './markers';
import { render } from './templates/render';
import { scaffoldAdd, scaffoldNew } from './index';

const cleanup: string[] = [];
// The acceptance export holds an installed node_modules, which takes longer to remove.
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
}, 60_000);

async function fresh() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-new-'));
  cleanup.push(directory);
  const target = join(directory, 'notes');
  await scaffoldNew({
    target,
    name: 'field-notes',
    displayName: 'Field notes',
    collection: 'note',
  });
  return { target, app: join(target, 'examples/field-notes') };
}

const read = (path: string) => readFile(path, 'utf8');

test('new writes one generated application and copies no example', async () => {
  const { target, app } = await fresh();
  expect(await readdir(join(target, 'examples'))).toEqual(['field-notes']);
  expect(JSON.parse(await read(join(target, 'app.config.json'))).application).toBe(
    '@field-notes/application',
  );
  expect(JSON.parse(await read(join(target, 'package.json'))).dependencies).toMatchObject({
    '@field-notes/application': 'workspace:*',
  });
  const lock = await read(join(target, 'bun.lock'));
  expect(lock).toContain('"examples/field-notes": {');
  expect(lock).toContain('"@field-notes/application": ["@field-notes/application@workspace:');
  expect(lock).not.toContain('examples/project-tasks');
  for (const path of ['manifest.ts', 'policy.ts', 'contracts/note.ts', 'ui/note.tsx'])
    expect(await read(join(app, path))).not.toContain('{{');
  expect(await read(join(app, 'manifest.ts'))).toContain('title: "Field notes"');
  expect(await read(join(app, 'test/conformance.test.ts'))).toContain("name: 'note_list'");
  // The skeleton ships as templates in the export, so the export can run `scaffold new` again.
  expect(await read(join(target, 'packages/scaffold/templates/application/policy.ts.tpl'))).toBe(
    await read(join(import.meta.dir, '../templates/application/policy.ts.tpl')),
  );
});

test('add extends the application at its markers and refuses to overwrite a part', async () => {
  const { target, app } = await fresh();
  const added = await scaffoldAdd(
    { kind: 'capability', id: 'note.archive', operationKind: 'command', description: 'Archive.' },
    { root: target },
  );
  expect(added).toMatchObject({ directory: 'examples/field-notes' });
  expect(added.written).toContain('contracts/note-archive.ts');
  await scaffoldAdd({ kind: 'collection', name: 'site' }, { root: target });
  await scaffoldAdd({ kind: 'target', name: 'ledger', collection: 'note' }, { root: target });
  const contracts = await read(join(app, 'contracts.ts'));
  for (const key of ['noteArchive,', '...siteOperations,', 'ledgerSync: ledgerTarget.sync,'])
    expect(contracts).toContain(key);
  expect(
    contracts
      .trimEnd()
      .split('\n')
      .filter((line) => line.includes('// scaffold:operations')),
  ).toHaveLength(1);
  const policy = await read(join(app, 'policy.ts'));
  expect(policy).toContain('[operations.noteArchive.id]: editor,');
  expect(policy).toContain('targetLane(ledgerTarget');
  expect(await read(join(app, 'screens.tsx'))).toContain(
    "{ path: 'ledger', component: LedgerScreen }",
  );
  await expect(scaffoldAdd({ kind: 'collection', name: 'site' }, { root: target })).rejects.toThrow(
    'Refusing to overwrite contracts/site.ts',
  );
  await expect(
    scaffoldAdd({ kind: 'target', name: 'erp', collection: 'missing' }, { root: target }),
  ).rejects.toThrow('No collection missing');
  await expect(
    scaffoldAdd(
      { kind: 'capability', id: 'Archive', operationKind: 'query', description: 'x' },
      { root: target },
    ),
  ).rejects.toThrow('Operation ID must be dotted lowercase words');
});

test('add refuses an application that was not generated', async () => {
  const { target } = await fresh();
  await rm(join(target, 'examples/field-notes/policy.ts'));
  await expect(scaffoldAdd({ kind: 'collection', name: 'site' }, { root: target })).rejects.toThrow(
    'was not created by scaffold new',
  );
});

test('a missing marker fails instead of editing unmarked code', () => {
  const source = 'export const operations = {\n  // scaffold:operations\n};\n';
  expect(insertAtMarker(source, 'operations', ['a,'])).toBe(
    'export const operations = {\n  a,\n  // scaffold:operations\n};\n',
  );
  expect(() => insertAtMarker(source, 'handlers', ['a,'])).toThrow(
    'Missing "// scaffold:handlers" marker',
  );
});

test('the workspace goes into each lockfile section in code-point order', () => {
  const lock = [
    '{',
    '  "workspaces": {',
    '    "": {',
    '      "dependencies": {',
    '        "@a/x": "workspace:*",',
    '        "@z/x": "workspace:*",',
    '      },',
    '    },',
    '    "examples/a": {',
    '      "name": "@a/x",',
    '    },',
    '  },',
    '  "packages": {',
    '    "@a/x": ["@a/x@workspace:examples/a"],',
    '',
    '    "@z/x": ["@z/x@workspace:packages/z"],',
    '  }',
    '}',
  ].join('\n');
  const next = addWorkspace(lock, {
    directory: 'examples/m',
    packageName: '@m/application',
    files: {},
  }).split('\n');
  const at = (text: string) => next.findIndex((line) => line.includes(text));
  expect(at('"@a/x": "workspace')).toBeLessThan(at('"@m/application": "workspace'));
  expect(at('"@m/application": "workspace')).toBeLessThan(at('"@z/x": "workspace'));
  expect(at('"examples/a": {')).toBeLessThan(at('"examples/m": {'));
  expect(at('"@m/application": ["@m/application@workspace:examples/m"]')).toBeLessThan(
    at('"@z/x": ['),
  );
});

test('a template placeholder without a value throws', () => {
  expect(render('{{app.kebab}}-{{home}}', { 'app.kebab': 'a', home: '/b' })).toBe('a-/b');
  expect(() => render('{{app.title}}', {})).toThrow('Template has no value for {{app.title}}');
});

const acceptance = process.env.SCAFFOLD_ACCEPTANCE === '1' ? test : test.skip;

acceptance(
  'a new application with every part installs frozen, generates, typechecks, builds and passes its unit and browser tests',
  async () => {
    const { target } = await fresh();
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      CI: '1',
      SCAFFOLD_ACCEPTANCE: '0',
    };
    const run = async (command: string[]) => {
      const child = Bun.spawn(command, { cwd: target, env, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0)
        throw new Error(`${command.join(' ')} failed (${code}):\n${stdout}\n${stderr}`);
    };
    await run(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']);
    const cli = ['bun', 'run', 'scaffold', 'add'];
    await run([...cli, 'collection', 'site']);
    await run([
      ...cli,
      'capability',
      'note.archive',
      '--kind',
      'command',
      '--description',
      'Archive a note.',
    ]);
    await run([...cli, 'target', 'ledger', '--collection', 'note']);
    for (const script of ['format', 'generate', 'check:generated', 'typecheck', 'build'])
      await run(['bun', 'run', script]);
    await run(['bun', 'test', 'examples/field-notes']);
    await run(['bunx', 'playwright', 'test', 'examples/field-notes']);
  },
  600_000,
);
