import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
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
  return { target, app: join(target, 'showcase/examples/field-notes') };
}

const read = (path: string) => readFile(path, 'utf8');

test('new writes one generated application and copies no example', async () => {
  const { target, app } = await fresh();
  expect(await readdir(join(target, 'showcase', 'examples'))).toEqual(['field-notes']);
  expect(JSON.parse(await read(join(target, 'app.config.json'))).application).toBe(
    '@field-notes/application',
  );
  expect(JSON.parse(await read(join(target, 'package.json'))).dependencies).toMatchObject({
    '@field-notes/application': 'workspace:*',
  });
  const lock = await read(join(target, 'bun.lock'));
  expect(lock).toContain('"showcase/examples/field-notes": {');
  expect(lock).toContain('"@field-notes/application": ["@field-notes/application@workspace:');
  expect(lock).not.toContain('showcase/examples/field-service');
  // The patterns go too, with their workspace entry and root dependencies.
  expect(await readdir(join(target, 'showcase'))).not.toContain('patterns');
  expect(lock).not.toContain('showcase/patterns/base');
  const root = JSON.parse(await read(join(target, 'package.json')));
  expect(root.workspaces).not.toContain('showcase/patterns/*');
  expect(root.dependencies).not.toHaveProperty('@agent-native/pattern-base');
  for (const path of ['manifest.ts', 'policy.ts', 'contracts/note.ts', 'ui/note.tsx'])
    expect(await read(join(app, path))).not.toContain('{{');
  expect(await read(join(app, 'manifest.ts'))).toContain('title: "Field notes"');
  expect(await read(join(app, 'test/conformance.test.ts'))).toContain("name: 'note_list'");
  // The overview map cites the examples the export leaves out; the page keeps its prose.
  expect(await readdir(join(target, 'scripts'))).not.toContain('overview.ts');
  const site = await readdir(join(target, 'docs/site/src'));
  expect(site).not.toContain('overview');
  expect(await readdir(join(target, 'docs/site/src/components'))).not.toContain(
    'OverviewView.astro',
  );
  // The rest of the site goes along, so the export's docs still build.
  expect(await readdir(join(target, 'docs/site/src/components'))).toContain('Tortoise.astro');
  expect(site).not.toContain('content');
  const page = await read(join(target, 'docs/overview.md'));
  expect(page).toContain('## Outbox phases');
  expect(page).not.toContain('<OverviewView');
  // The skeleton ships as templates in the export, so the export can run `scaffold new` again.
  expect(await read(join(target, 'packages/scaffold/templates/application/policy.ts.tpl'))).toBe(
    await read(join(import.meta.dir, '../templates/application/policy.ts.tpl')),
  );
});

test('a published-framework export depends on framework versions instead of copying them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-published-'));
  cleanup.push(directory);
  const target = join(directory, 'notes');
  const manifest = await scaffoldNew({
    target,
    name: 'field-notes',
    collection: 'note',
    published: { registry: 'http://127.0.0.1:4873/' },
  });
  const version = JSON.parse(
    await read(join(import.meta.dir, '../../kernel/package.json')),
  ).version;
  expect(manifest.framework).toEqual({ version, registry: 'http://127.0.0.1:4873/' });
  expect((await readdir(target)).sort()).not.toContain('packages');
  expect(await readdir(target)).not.toContain('plugins');
  expect(await readdir(target)).not.toContain('bun.lock');
  // Skills come from the installed packages; the framework's review record stays behind.
  expect(await readdir(join(target, 'scripts'))).not.toContain('reviewed-surface.json');
  expect(await readdir(join(target, 'scripts'))).not.toContain('skill-coverage.json');
  expect(await readdir(join(target, 'scripts'))).not.toContain('check-skills.test.ts');
  expect(await readdir(join(target, 'scripts'))).toContain('skills-link.ts');
  expect(await readdir(join(target, 'scripts'))).toContain('skills-stamp.ts');
  const root = JSON.parse(await read(join(target, 'package.json')));
  expect(root.workspaces).toEqual(['apps/*', 'showcase/examples/*', 'docs/site']);
  expect(root.dependencies).toMatchObject({
    '@agent-native/kernel': version,
    '@agent-native/site': version,
    '@field-notes/application': 'workspace:*',
  });
  expect(root.scripts.scaffold).toBe('bun node_modules/@agent-native/scaffold/src/cli.ts');
  expect(root.scripts['test:portable']).toBeUndefined();
  expect(root.scripts.build).toBe('bun run build:web');
  expect(root.scripts.check).toContain('bun run check:framework');
  expect(root.scripts.check).not.toContain('check:manifests');
  expect(root.scripts.check).not.toContain('check:registry:operator');
  expect(root.scripts['skills:stamp']).toBe('bun scripts/skills-stamp.ts');
  const tsconfig = JSON.parse(await read(join(target, 'tsconfig.json')));
  expect(tsconfig.include).not.toContain('packages');
  expect(tsconfig.compilerOptions.paths['@/*']).toContain(
    './node_modules/@agent-native/frame/src/*',
  );
  expect(await read(join(target, 'apps/web/src/styles.css'))).toContain(
    "@import '../../../node_modules/@agent-native/operator-ui/src/styles/operator.css';",
  );
  expect(await read(join(target, 'bunfig.toml'))).toContain(
    '"@agent-native" = "http://127.0.0.1:4873/"',
  );
});

test('add extends the application at its markers and refuses to overwrite a part', async () => {
  const { target, app } = await fresh();
  const added = await scaffoldAdd(
    { kind: 'capability', id: 'note.archive', operationKind: 'command', description: 'Archive.' },
    { root: target },
  );
  expect(added).toMatchObject({ directory: 'showcase/examples/field-notes' });
  expect(added.written).toContain('contracts/note-archive.ts');
  // The capability acts on the note collection its ID names.
  expect(await read(join(app, 'contracts/note-archive.ts'))).toContain("resourceType: 'Note'");
  await scaffoldAdd({ kind: 'collection', name: 'site', tree: true }, { root: target });
  const sites = await read(join(app, 'contracts/site.ts'));
  for (const key of [
    "parent: 'parentId',",
    'siteTree: collectionTree(',
    'siteMove: collectionMove(',
  ])
    expect(sites).toContain(key);
  expect(await read(join(app, 'ui/site.tsx'))).toContain('<CollectionTree');
  const ledger = await scaffoldAdd(
    { kind: 'target', name: 'ledger', collection: 'note' },
    { root: target },
  );
  // The target's required destination is switched off in the desktop policy until it is bound.
  expect(ledger.policy).toBe('apps/desktop/site-policy.json');
  expect(
    JSON.parse(await read(join(target, 'apps/desktop/site-policy.json'))).destinations[
      'ledger-api'
    ],
  ).toMatchObject({ disabled: true });
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
  expect(policy).toContain("[operations.siteTree.id]: 'open',");
  expect(policy).toContain('[operations.siteRetire.id]: editor,');
  expect(policy).toContain('targetAllowlist(ledgerTarget');
  expect(await read(join(app, 'screens.tsx'))).toContain(
    "{ path: 'ledger', component: LedgerScreen }",
  );
  // The first agent mounts the approval feature and adds its screen; a second adds only itself.
  const closer = await scaffoldAdd(
    { kind: 'agent', name: 'closer', collection: 'note' },
    { root: target },
  );
  expect(closer.written).toEqual(
    expect.arrayContaining(['contracts/closer-agent.ts', 'ui/approvals.tsx']),
  );
  expect(closer.written).not.toContain('handlers/approvals.ts');
  const second = await scaffoldAdd(
    { kind: 'agent', name: 'reviewer', collection: 'site' },
    { root: target },
  );
  expect(second.written).not.toContain('ui/approvals.tsx');
  const withAgents = await read(join(app, 'contracts.ts'));
  expect(withAgents.match(/'approval',/g)).toHaveLength(1);
  for (const key of ['closerAgent,', 'reviewerAgent,']) expect(withAgents).toContain(key);
  expect((await read(join(app, 'manifest.ts'))).match(/approvalFeatureManifest,/g)).toHaveLength(1);
  expect(await read(join(app, 'application.ts'))).toContain('approvalFeature(), {');
  expect(await read(join(app, 'policy.ts'))).toContain('export const approvalAccess');
  expect(await read(join(app, 'domain.ts'))).not.toContain('approvals');
  // A feature goes into the manifest, the application and, with screens, defineScreens.
  const stock = await scaffoldAdd(
    { kind: 'feature', name: 'stock', screens: true },
    { root: target },
  );
  expect(stock.written).toEqual(
    expect.arrayContaining([
      'features/stock/contracts.ts',
      'features/stock/feature.ts',
      'features/stock/screens.tsx',
      'test/stock-feature.test.ts',
    ]),
  );
  expect(await read(join(app, 'manifest.ts'))).toMatch(
    /approvalFeatureManifest,\n\s*stockFeatureManifest,/,
  );
  expect(await read(join(app, 'application.ts'))).toContain('stockFeature(), {');
  expect(await read(join(app, 'screens.tsx'))).toContain('stockScreens,');
  const headless = await scaffoldAdd({ kind: 'feature', name: 'score' }, { root: target });
  expect(headless.written).not.toContain('features/score/screens.tsx');
  expect(await read(join(app, 'screens.tsx'))).not.toContain('tallyScreens');
  // The first assignment kind declares the assignments and mounts the feature; a second joins.
  const inspection = await scaffoldAdd(
    { kind: 'assignment-kind', name: 'inspection', collection: 'note' },
    { root: target },
  );
  expect(inspection.written).toEqual(
    expect.arrayContaining([
      'contracts/inspection-assignment.ts',
      'contracts/assignments.ts',
      'handlers/assignments.ts',
      'ui/inspection-assignments.tsx',
      'test/inspection-assignment.test.ts',
    ]),
  );
  const siteCheck = await scaffoldAdd(
    { kind: 'assignment-kind', name: 'site-check', collection: 'site' },
    { root: target },
  );
  expect(siteCheck.written).not.toContain('contracts/assignees.ts');
  expect(await read(join(app, 'contracts/assignments.ts'))).toMatch(/inspection,\n\s*siteCheck,/);
  expect(await read(join(app, 'handlers/assignments.ts'))).toContain(
    "'site-check': siteCheckHooks,",
  );
  const mounted = await read(join(app, 'application.ts'));
  expect(mounted.match(/assignmentFeature\(assignments\)/g)).toHaveLength(1);
  expect(mounted.match(/import \{ mountFeature \}/g)).toHaveLength(1);
  expect((await read(join(app, 'manifest.ts'))).match(/assignments\.manifest,/g)).toHaveLength(1);
  expect(await read(join(app, 'policy.ts'))).toContain('export const assignmentAccess');
  await expect(
    scaffoldAdd(
      { kind: 'assignment-kind', name: 'audit', collection: 'missing' },
      { root: target },
    ),
  ).rejects.toThrow('No collection missing');
  await expect(scaffoldAdd({ kind: 'feature', name: 'Stock' }, { root: target })).rejects.toThrow(
    'Feature ID must be lowercase words',
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
  await rm(join(target, 'showcase/examples/field-notes/policy.ts'));
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
    '    "showcase/examples/a": {',
    '      "name": "@a/x",',
    '    },',
    '  },',
    '  "packages": {',
    '    "@a/x": ["@a/x@workspace:showcase/examples/a"],',
    '',
    '    "@z/x": ["@z/x@workspace:packages/z"],',
    '  }',
    '}',
  ].join('\n');
  const next = addWorkspace(lock, {
    directory: 'showcase/examples/m',
    packageName: '@m/application',
    files: {},
  }).split('\n');
  const at = (text: string) => next.findIndex((line) => line.includes(text));
  expect(at('"@a/x": "workspace')).toBeLessThan(at('"@m/application": "workspace'));
  expect(at('"@m/application": "workspace')).toBeLessThan(at('"@z/x": "workspace'));
  expect(at('"showcase/examples/a": {')).toBeLessThan(at('"showcase/examples/m": {'));
  expect(at('"@m/application": ["@m/application@workspace:showcase/examples/m"]')).toBeLessThan(
    at('"@z/x": ['),
  );
});

test('a template placeholder without a value throws', () => {
  expect(render('{{app.kebab}}-{{home}}', { 'app.kebab': 'a', home: '/b' })).toBe('a-/b');
  expect(() => render('{{app.title}}', {})).toThrow('Template has no value for {{app.title}}');
});

const acceptance = process.env.SCAFFOLD_ACCEPTANCE === '1' ? test : test.skip;

/** Run a command in `cwd`, failing with its output. */
async function exec(command: string[], cwd: string, env: Record<string, string | undefined>) {
  const child = Bun.spawn(command, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(' ')} failed (${code}):\n${stdout}\n${stderr}`);
}

acceptance(
  'a new application installs the framework from a registry, frozen, and passes its own check',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-registry-'));
    cleanup.push(directory);
    const { packFramework } = await import('../../../scripts/release');
    const { startLocalRegistry } = await import('../../../scripts/local-registry');
    const packed = join(directory, 'release');
    await packFramework(packed, join(import.meta.dir, '../../..'));
    const registry = await startLocalRegistry(packed);
    try {
      const target = join(directory, 'notes');
      await scaffoldNew({
        target,
        name: 'field-notes',
        collection: 'note',
        published: { registry: registry.url },
      });
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        CI: '1',
        SCAFFOLD_ACCEPTANCE: '0',
        // A cache of its own, so a tarball cached at the same version from an earlier pack
        // cannot stand in for the one packed here.
        BUN_INSTALL_CACHE_DIR: join(directory, 'cache'),
      };
      const run = (command: string[]) => exec(command, target, env);
      // The first install writes the lockfile; a clean install then has to match it exactly.
      await run(['bun', 'install', '--ignore-scripts']);
      await rm(join(target, 'node_modules'), { recursive: true, force: true });
      await run(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']);
      // The framework's skills ship in the installed packages and link from there.
      await run(['bun', 'run', 'skills:link']);
      expect(
        await realpath(join(target, '.claude/skills/build-screens')).then((path) =>
          path.endsWith('node_modules/@agent-native/frame/skills/build-screens'),
        ),
      ).toBe(true);
      await run(['bun', 'run', 'scaffold', 'add', 'target', 'ledger', '--collection', 'note']);
      await run(['bun', 'run', 'format']);
      await run(['bun', 'run', 'check']);
      await run(['bunx', 'playwright', 'test', 'showcase/examples/field-notes']);
    } finally {
      await registry.stop();
    }
  },
  900_000,
);

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
    await run([...cli, 'collection', 'site', '--tree']);
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
    await run([...cli, 'agent', 'closer', '--collection', 'note']);
    await run([...cli, 'feature', 'stock', '--screens']);
    for (const script of ['format', 'generate', 'typecheck', 'build'])
      await run(['bun', 'run', script]);
    await run(['bun', 'test', 'showcase/examples/field-notes']);
    await run(['bunx', 'playwright', 'test', 'showcase/examples/field-notes']);
  },
  600_000,
);
