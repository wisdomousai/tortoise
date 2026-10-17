import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from './index';

test('source export is deterministic, independent and excludes private/runtime artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-fixture-'));
  const source = join(directory, 'source');
  try {
    await mkdir(join(source, 'apps/web'), { recursive: true });
    await mkdir(join(source, 'packages/core/src'), { recursive: true });
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'canonical-starter', version: '0.1.0', workspaces: ['packages/*'] }),
    );
    await writeFile(
      join(source, 'app.config.json'),
      JSON.stringify({
        name: 'canonical-starter',
        displayName: 'Reference',
        appId: 'dev.agentnative.workspace',
      }),
    );
    await writeFile(join(source, 'bun.lock'), '{"workspaces":{"":{"name":"canonical-starter"}}}');
    await writeFile(join(source, 'apps/web/index.html'), '<title>Reference</title>');
    await writeFile(join(source, 'packages/core/src/index.ts'), 'export const value = 1;');
    await writeFile(join(source, 'packages/core/src/credentials.json'), '{"token":"PRIVATE"}');
    await writeFile(join(source, 'apps/.connection.json'), '{"token":"PRIVATE"}');
    await writeFile(join(source, 'apps/.env.local'), 'SECRET=PRIVATE');
    await mkdir(join(source, 'node_modules'), { recursive: true });
    await writeFile(join(source, 'node_modules/private.json'), '{}');
    await mkdir(join(source, 'apps/mobile/android/app'), { recursive: true });
    await writeFile(join(source, 'apps/mobile/android/app/build.json'), '{}');
    await mkdir(join(source, 'apps/mobile/.expo'), { recursive: true });
    await writeFile(join(source, 'apps/mobile/.expo/devices.json'), '{}');
    await writeFile(join(source, 'apps/mobile/index.ts'), 'export {};');
    await symlink(join(source, 'package.json'), join(source, 'packages/linked.json'));
    const first = await scaffold({
      sourceRoot: source,
      target: join(directory, 'first'),
      name: 'new-app',
      displayName: 'New & App',
    });
    const second = await scaffold({
      sourceRoot: source,
      target: join(directory, 'second'),
      name: 'new-app',
      displayName: 'New & App',
    });
    expect(first).toEqual(second);
    expect(first.files.map((file) => file.path)).toEqual([
      'app.config.json',
      'apps/mobile/index.ts',
      'apps/web/index.html',
      'bun.lock',
      'package.json',
      'packages/core/src/index.ts',
    ]);
    expect(JSON.parse(await readFile(join(directory, 'first/app.config.json'), 'utf8'))).toEqual({
      name: 'new-app',
      displayName: 'New & App',
      appId: 'dev.agentnative.new-app',
    });
    expect(JSON.parse(await readFile(join(directory, 'first/package.json'), 'utf8')).name).toBe(
      'new-app',
    );
    expect(await readFile(join(directory, 'first/apps/web/index.html'), 'utf8')).toBe(
      '<title>New &amp; App</title>',
    );
    expect((await readdir(join(directory, 'first'))).includes('node_modules')).toBe(false);
    await expect(
      scaffold({ sourceRoot: source, target: join(directory, 'first'), name: 'new-app' }),
    ).rejects.toThrow('Refusing');
    await expect(
      scaffold({ sourceRoot: source, target: join(source, 'nested'), name: 'new-app' }),
    ).rejects.toThrow('outside');
    await symlink(source, join(directory, 'source-alias'));
    await expect(
      scaffold({
        sourceRoot: source,
        target: join(directory, 'source-alias/nested/new'),
        name: 'new-app',
      }),
    ).rejects.toThrow('outside');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an example export keeps only that example and configures it as the hosted application', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-example-'));
  const source = join(directory, 'source');
  try {
    for (const name of ['alpha', 'beta']) {
      await mkdir(join(source, 'examples', name), { recursive: true });
      await writeFile(
        join(source, 'examples', name, 'package.json'),
        JSON.stringify({ name: `@scope/${name}` }),
      );
      await writeFile(
        join(source, 'examples', name, 'manifest.ts'),
        `export default defineManifest({ id: '${name}-app', title: 'T', modules: [] });`,
      );
    }
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({
        name: 'canonical-starter',
        version: '0.1.0',
        dependencies: { '@scope/alpha': 'workspace:*', '@scope/beta': 'workspace:*', zod: '4' },
      }),
    );
    await writeFile(
      join(source, 'app.config.json'),
      JSON.stringify({
        name: 'canonical-starter',
        displayName: 'Reference',
        appId: 'dev.agentnative.workspace',
        application: '@scope/alpha',
      }),
    );
    await writeFile(
      join(source, 'bun.lock'),
      [
        '{',
        '  "workspaces": {',
        '    "": {',
        '      "dependencies": {',
        '        "@scope/alpha": "workspace:*",',
        '        "@scope/beta": "workspace:*",',
        '      },',
        '    },',
        '    "examples/alpha": {',
        '      "name": "@scope/alpha",',
        '    },',
        '    "examples/beta": {',
        '      "name": "@scope/beta",',
        '    },',
        '  },',
        '  "packages": {',
        '    "@scope/alpha": ["@scope/alpha@workspace:examples/alpha"],',
        '    "@scope/beta": ["@scope/beta@workspace:examples/beta"],',
        '  }',
        '}',
      ].join('\n'),
    );
    const target = join(directory, 'target');
    const manifest = await scaffold({
      sourceRoot: source,
      target,
      name: 'new-app',
      example: 'beta',
    });
    expect(manifest.example).toBe('beta');
    expect(manifest.files.map((file) => file.path)).toEqual([
      'app.config.json',
      'bun.lock',
      'examples/beta/manifest.ts',
      'examples/beta/package.json',
      'package.json',
    ]);
    expect(JSON.parse(await readFile(join(target, 'app.config.json'), 'utf8')).application).toBe(
      '@scope/beta',
    );
    expect(JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).dependencies).toEqual({
      '@scope/beta': 'workspace:*',
      zod: '4',
    });
    const lock = await readFile(join(target, 'bun.lock'), 'utf8');
    expect(lock).not.toContain('alpha');
    expect(lock).toContain('"examples/beta"');
    await expect(
      scaffold({
        sourceRoot: source,
        target: join(directory, 'other'),
        name: 'x',
        example: 'gamma',
      }),
    ).rejects.toThrow('Unknown example');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects checkout-specific absolute source paths before creating a target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-path-'));
  const source = join(directory, 'source');
  const target = join(directory, 'target');
  try {
    await mkdir(source);
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'reference', version: '0.1.0' }),
    );
    await writeFile(join(source, 'README.md'), `Run from ${source}`);
    await expect(scaffold({ sourceRoot: source, target, name: 'new-app' })).rejects.toThrow(
      'absolute path',
    );
    expect(await readdir(directory)).toEqual(['source']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Explicit acceptance avoids recursively exporting/installing from the exported test suite.
const standalone = process.env.SCAFFOLD_ACCEPTANCE === '1' ? test : test.skip;

/** Apply an authoring edit to an exported file; a pattern that no longer matches fails loudly. */
const patched = (source: string, pattern: string | RegExp, replacement: string) => {
  const result = source.replace(pattern, replacement);
  if (result === source) throw new Error(`Authoring patch no longer matches: ${pattern}`);
  return result;
};
standalone(
  'complete source export installs pinned dependencies, typechecks, builds and tests independently',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-scaffold-acceptance-'));
    const target = join(directory, 'fresh-application');
    try {
      const manifest = await scaffold({ target, name: 'fresh-application' });
      expect(JSON.parse(await readFile(join(target, 'app.config.json'), 'utf8'))).toEqual({
        name: 'fresh-application',
        displayName: 'Fresh Application',
        appId: 'dev.agentnative.fresh-application',
        application: '@agent-native/project-tasks',
      });
      expect(manifest.files.some((file) => file.path === 'packages/runtime/src/index.ts')).toBe(
        true,
      );
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        CI: '1',
        SCAFFOLD_ACCEPTANCE: '0',
      };
      for (const command of [
        ['bun', 'install', '--frozen-lockfile', '--ignore-scripts'],
        ['bun', 'run', 'check:format'],
        ['bun', 'run', 'typecheck'],
        ['bun', 'run', 'generate'],
        ['bun', 'run', 'build'],
        ['bun', 'test'],
      ]) {
        const result = Bun.spawn(command, { cwd: target, env, stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, code] = await Promise.all([
          new Response(result.stdout).text(),
          new Response(result.stderr).text(),
          result.exited,
        ]);
        if (code !== 0)
          throw new Error(
            `Standalone ${command.join(' ')} failed (${code}):\n${stdout}\n${stderr}`,
          );
      }
      expect(await readFile(join(target, 'dist/web/project-tasks/index.html'), 'utf8')).toContain(
        '<title>Fresh Application</title>',
      );
      // Exercise authoring in the exported application, not in the original checkout.
      const contractsPath = join(target, 'examples/project-tasks/contracts.ts');
      let contracts = await readFile(contractsPath, 'utf8');
      contracts = patched(
        contracts,
        'export const operations = {',
        `export const operations = {
  projectSummary: defineCapability({ id: 'project.summary', kind: 'query', input: jsonSchema(idInput), output: jsonSchema(z.strictObject({ id, taskCount: z.number().int() })), permission: { action: 'read', resourceType: 'Project' }, ui: { exception: 'Headless scaffold extension verification' } }),`,
      );
      contracts = patched(contracts, /('task\.set-status')(,?\s*\])/, "$1, 'project.summary'$2");
      await writeFile(contractsPath, contracts);
      const handlersPath = join(target, 'examples/project-tasks/handlers/projects.ts');
      const handlers = patched(
        await readFile(handlersPath, 'utf8'),
        '>[] => [',
        `>[] => [
  handler(operations.projectSummary, (input, ctx) => ({ id: project(ctx.state, input.id).id, taskCount: Object.values(ctx.state.tasks).filter(task => task.projectId === input.id).length })),`,
      );
      await writeFile(handlersPath, handlers);
      await writeFile(
        join(target, 'examples/project-tasks/scaffold-extension.test.ts'),
        `import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHost } from '@agent-native/host';
import { createHttpTransport } from '@agent-native/client';
import application from './application';
test('authored summary is available through the exported HTTP host', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'authored-extension-'));
  const host = await startHost(application, { workspacePath: workspace });
  try {
    const connection = await Bun.file(host.connectionFile!).json();
    const transport = createHttpTransport({ baseUrl: host.url, token: connection.token });
    const project = await transport.command<{ id: string }>('project.create', { name: 'Extension' });
    await transport.command('task.create', { projectId: project.result.id, title: 'One task' });
    expect((await transport.query('project.summary', { id: project.result.id })).data).toEqual({ id: project.result.id, taskCount: 1 });
    const contract = await transport.catalog();
    expect(contract.operations.find(operation => operation.id === 'project.summary')?.mcpName).toBe('project_summary');
  } finally { await host.close(); await rm(workspace, { recursive: true, force: true }); }
});
`,
      );
      for (const command of [
        ['bun', 'run', 'format'],
        ['bun', 'run', 'check:format'],
        ['bun', 'run', 'generate'],
        ['bun', 'run', 'typecheck'],
        ['bun', 'test', 'examples/project-tasks/scaffold-extension.test.ts'],
      ]) {
        const result = Bun.spawn(command, { cwd: target, env, stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, code] = await Promise.all([
          new Response(result.stdout).text(),
          new Response(result.stderr).text(),
          result.exited,
        ]);
        if (code !== 0)
          throw new Error(
            `Standalone extension ${command.join(' ')} failed (${code}):\n${stdout}\n${stderr}`,
          );
      }
      const generated = JSON.parse(
        await readFile(join(target, 'dist/reference/project-tasks/contract.json'), 'utf8'),
      ) as {
        operations: { id: string; mcpName: string; ui: { exception?: string } }[];
        workflows: { operations: string[] }[];
      };
      expect(
        generated.operations.find((operation) => operation.id === 'project.summary'),
      ).toMatchObject({
        mcpName: 'project_summary',
        ui: { exception: 'Headless scaffold extension verification' },
      });
      expect(
        generated.workflows.some((workflow) => workflow.operations.includes('project.summary')),
      ).toBe(true);
      expect(
        await readFile(join(target, 'dist/reference/project-tasks/openapi.json'), 'utf8'),
      ).toContain('/api/v1/queries/project.summary');
      expect(
        await readFile(join(target, 'dist/reference/project-tasks/operations.md'), 'utf8'),
      ).toContain('project.summary');
      expect(
        await readFile(join(target, 'dist/reference/project-tasks/workflows.md'), 'utf8'),
      ).toContain('project.summary');
      expect(
        await readFile(
          join(target, 'dist/reference/project-tasks/application-skill/SKILL.md'),
          'utf8',
        ),
      ).toContain('project_summary');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
