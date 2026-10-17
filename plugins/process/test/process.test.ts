import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  collectRequirements,
  defineHostComponent,
  failClosedAuditMode,
  type AuditRecord,
  type ProcessRequirement,
} from '@agent-native/contracts';
import { resolveSitePolicy } from '@agent-native/site/policy';
import { defineApplication } from '@agent-native/host/application';
import { defineManifest } from '@agent-native/host/manifest';
import { bunProcesses, defineHostPlugin } from '@agent-native/host/plugin';
import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { openPlugins } from '@agent-native/host/plugins/lifecycle';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { processPlugin } from '../src/plugin';
import { processPluginManifest } from '../src/plugin-manifest';

const fixture = join(import.meta.dir, 'fixtures', 'echo-env.ts');
const declare = (id: string, extra: Partial<ProcessRequirement> = {}): ProcessRequirement => ({
  id,
  executable: 'configured',
  purpose: `${id} for tests`,
  availability: 'optional',
  ...extra,
});
const component = defineHostComponent({
  id: 'drivers',
  description: 'Processes the tests start',
  requirements: {
    processes: [
      declare('echo'),
      declare('pinned'),
      declare('licensed', { secrets: ['VENDOR_LICENSE'] }),
      declare('unbound'),
      declare('off'),
    ],
  },
});
const requirements = collectRequirements([component]);

const recorded: AuditRecord[] = [];
const recorderManifest = definePluginManifest({ id: 'recorder', title: 'Recorder' });
const recorder = defineHostPlugin({
  manifest: recorderManifest,
  open: async () => ({
    ports: {
      eventLog: {
        mode: failClosedAuditMode,
        append: async (records) => (recorded.push(...records), []),
      },
    },
  }),
});
const definition = defineApplication({
  manifest: defineManifest({
    id: 'drivers',
    title: 'Drivers',
    modules: [],
    components: [component],
    plugins: [sitePluginManifest, processPluginManifest, recorderManifest],
  }),
  createState: () => ({}),
  handlers: [],
  authorization: { authorize: () => ({ allowed: false }), canReadEvent: () => false },
  plugins: [sitePlugin, processPlugin, recorder],
});

const directory = await mkdtemp(join(tmpdir(), 'process-plugin-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

async function open(processes: Record<string, unknown>) {
  const path = join(directory, `policy-${crypto.randomUUID()}.json`);
  await writeFile(
    path,
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' }, processes }),
  );
  return openPlugins(definition, {
    workspacePath: directory,
    component: 'authority',
    instance: 'test',
    serving: true,
    settings: { 'site-policy': path },
  });
}
const bun = { executable: process.execPath, args: [fixture] };

/** The first line a child prints, parsed. */
async function firstLine(stream: NodeJS.ReadableStream) {
  for await (const line of createInterface({ input: stream })) return JSON.parse(line);
  throw new Error('The child printed nothing');
}

describe('site policy process bindings', () => {
  test('bindings are checked against declarations and the plugin-owned variables', () => {
    const resolved = resolveSitePolicy(
      {
        processes: {
          echo: { executable: 'bun', cwd: 'relative' },
          licensed: { executable: '/opt/x', env: { VENDOR_LICENSE: 'x', HTTPS_PROXY: 'y' } },
          ghost: { executable: '/opt/ghost' },
        },
      },
      collectRequirements([
        component,
        defineHostComponent({
          id: 'more',
          description: 'A required process',
          requirements: { processes: [declare('needed', { availability: 'required' })] },
        }),
      ]),
    );
    expect(resolved.findings.map((finding) => [finding.code, finding.destination])).toEqual([
      ['PROCESS_PATH', 'echo'],
      ['PROCESS_PATH', 'echo'],
      ['PROCESS_ENV', 'licensed'],
      ['PROCESS_ENV', 'licensed'],
      ['UNDECLARED_PROCESS', 'ghost'],
      ['REQUIRED_PROCESS_UNBOUND', 'needed'],
    ]);
    expect(resolved.processes.size).toBe(0);
  });

  test('a secret name that is not an environment variable is refused at composition', () => {
    expect(() =>
      collectRequirements([
        defineHostComponent({
          id: 'bad',
          description: 'Bad secret',
          requirements: { processes: [declare('bad', { secrets: ['vendor-license'] })] },
        }),
      ]),
    ).toThrow('Invalid secret variable vendor-license');
  });
});

describe('process plugin', () => {
  test('starts a bound process with only the basics and its configured variables', async () => {
    const opened = await open({
      echo: { ...bun, env: { STATION: 'line-3' } },
      off: { disabled: true },
    });
    const spawn = bunProcesses(opened.ports.processes);
    const started = await spawn('echo', { args: ['--hello'] });
    const hello = await firstLine(started.child.stdout);
    expect(hello.args).toEqual(['--hello']);
    expect(hello.env.STATION).toBe('line-3');
    // Nothing from the host leaks in: no PATH, no HOME, no provider keys.
    expect(Object.keys(hello.env).filter((key) => ['PATH', 'HOME', 'USER'].includes(key))).toEqual(
      [],
    );
    started.child.stdin.end();
    await new Promise((resolve) => started.child.once('exit', resolve));
    expect(recorded.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['child.started', 'child.exited']),
    );
    expect(opened.ports.processes.availability('off')).toMatchObject({
      available: false,
      reason: expect.stringContaining('disabled by the site policy'),
    });
    expect(opened.ports.processes.availability('unbound')).toMatchObject({ available: false });
    await expect(spawn('unbound')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(spawn('undeclared')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(recorded).toContainEqual(
      expect.objectContaining({ kind: 'child.refused', data: { process: 'undeclared' } }),
    );
    await opened.close();
  });

  test('inputs reach the child on descriptors 3 and up, each ending after its bytes', async () => {
    const opened = await open({
      echo: {
        executable: process.execPath,
        args: [join(import.meta.dir, 'fixtures', 'read-inputs.ts')],
      },
    });
    const encode = (text: string) => new TextEncoder().encode(text);
    const started = await bunProcesses(opened.ports.processes)('echo', {
      inputs: [encode('first\0filter'), encode('x'.repeat(200_000))],
    });
    const [first, second] = await firstLine(started.child.stdout);
    expect(first).toBe('first\0filter');
    expect(second).toHaveLength(200_000);
    await new Promise((resolve) => started.child.once('exit', resolve));
    await opened.close();
  });

  test('terminating a child that has just finished does not throw', async () => {
    const opened = await open({ echo: bun });
    const started = await bunProcesses(opened.ports.processes)('echo');
    // Its output closes as it exits, often before the exit event: the group is then a zombie,
    // which macOS refuses to signal with EPERM.
    started.child.stdin.end();
    await new Promise((resolve) => started.child.stdout.on('end', resolve).resume());
    expect(() => started.terminate()).not.toThrow();
    await opened.close();
  });

  test('a pinned executable must match its digest before it runs', async () => {
    const digest = createHash('sha256')
      .update(await readFile(process.execPath))
      .digest('hex');
    const wrong = '0'.repeat(64);
    const opened = await open({
      echo: { ...bun, sha256: digest },
      pinned: { ...bun, sha256: wrong },
    });
    const spawn = bunProcesses(opened.ports.processes);
    const started = await spawn('echo');
    started.terminate();
    await expect(spawn('pinned')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await opened.close();
  });

  test('secrets need a platform secret store; without one the process is unavailable', async () => {
    const opened = await open({ licensed: bun });
    expect(opened.ports.processes.availability('licensed')).toMatchObject({
      available: false,
      reason: expect.stringContaining('this platform keeps none'),
    });
    await opened.close();
  });

  test('aborting and closing stop the whole process tree', async () => {
    const opened = await open({ echo: { ...bun, args: [fixture, '--hang'] } });
    const spawn = bunProcesses(opened.ports.processes);
    const controller = new AbortController();
    const aborted = await spawn('echo', { signal: controller.signal });
    const exited = new Promise((resolve) => aborted.child.once('exit', resolve));
    controller.abort();
    await exited;
    const closed = await spawn('echo');
    const closedExit = new Promise((resolve) => closed.child.once('exit', resolve));
    await opened.close();
    await closedExit;
    await expect(spawn('echo')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
