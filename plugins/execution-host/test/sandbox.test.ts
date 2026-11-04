// The real backend: bubblewrap on Linux. Skipped elsewhere; `bun run test:execution-host:linux`
// runs it in a container on any machine with Docker.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHost } from '@tortoise/host/host';
import type { ExecutionContext } from '@tortoise/runtime';
import type { ExecutionHost, SandboxTask } from '../src/run';
import { notesApplication, person } from './fixture';

const bwrap = process.env.BWRAP ?? '/usr/bin/bwrap';
const supported = process.platform === 'linux' && existsSync(bwrap);
const repo = resolve(import.meta.dir, '../../..');
const probe = join(import.meta.dir, 'fixtures', 'probe.ts');

type Host = Awaited<ReturnType<typeof startHost>>;
let host: Host;
let sandboxes: ExecutionHost;
let directory: string;
let upstream: Server;
let upstreamPort: number;

const grant = (
  operations: string[],
  extra: Partial<NonNullable<ExecutionContext['grant']>> = {},
) => ({
  ...person('ann'),
  grant: { operations, expiresAt: Date.now() + 60_000, ...extra },
});
const task = (mode: string, args: string[], overrides: Partial<SandboxTask> = {}): SandboxTask => ({
  sandbox: 'sandbox',
  command: ['bun', probe, mode, ...args],
  context: grant(['note.list', 'note.add']),
  readOnly: [repo],
  ...overrides,
});
const output = (stdout: string) => JSON.parse(stdout.trim().split('\n').at(-1)!);
const notes = async () =>
  (
    (await host.application.queryRaw({ operation: 'note.list', input: {} }, person('ann'))) as {
      data: { items: { id: string; text: string }[] };
    }
  ).data.items.map((note) => note.id);

describe.skipIf(!supported)('bubblewrap sandbox', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'execution-host-'));
    // The model API a sandbox may reach: a TCP listener that greets and closes.
    upstream = createServer((socket) => socket.end('hello\n'));
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
    upstreamPort = (upstream.address() as { port: number }).port;
    const policy = join(directory, 'site-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        mode: 'connected',
        audit: { mode: 'best-effort' },
        destinations: { 'model-api': { url: `tcp://127.0.0.1:${upstreamPort}` } },
        processes: { sandbox: { executable: bwrap }, offline: { executable: bwrap } },
      }),
    );
    host = await startHost(notesApplication({ tools: { bun: process.execPath } }), {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings: { 'site-policy': policy },
    });
    sandboxes = host.services['execution-host'] as ExecutionHost;
  });
  afterAll(async () => {
    await host?.close();
    upstream?.close();
    await rm(directory, { recursive: true, force: true });
  });

  test('a two-step task by CLI commits what its grant covers, and the receipt shows it', async () => {
    const context = grant(['note.list', 'note.add'], { resources: ['note:c1'] });
    const result = await sandboxes.run(
      task('cli', [join(repo, 'packages/adapters/src/cli.ts')], { context }),
    );
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, truncated: false });
    const { list, add, other } = output(result.stdout);
    expect(list).toMatchObject({ code: 0, out: { data: { items: [] } } });
    expect(add.code).toBe(0);
    expect(add.out.revisions).toEqual({ 'note:c1': 1 });
    // The grant names one note; another is refused inside the host's transaction.
    expect(other).toMatchObject({ code: 4, out: { error: { code: 'FORBIDDEN' } } });
    expect(await notes()).toEqual(['c1']);
  });

  test('the same two steps through MCP, from a client inside the sandbox', async () => {
    const context = grant(['note.list', 'note.add'], { resources: ['note:m1'] });
    const result = await sandboxes.run(
      task('mcp', [join(repo, 'packages/adapters/src/mcp.ts')], { context }),
    );
    expect(result.exitCode).toBe(0);
    const reply = output(result.stdout);
    expect(reply.tools).toEqual(expect.arrayContaining(['note_add', 'note_list']));
    expect(reply.added).toBe(false);
    expect(reply.other.isError).toBe(true);
    expect(await notes()).toContain('m1');
    expect(await notes()).not.toContain('m2');
  });

  test('files, processes, network and kernel calls outside the profile fail', async () => {
    const secrets = join(directory, 'secrets');
    await mkdir(secrets);
    await writeFile(join(secrets, 'key'), 'do not read');
    const work = join(directory, 'work');
    await mkdir(work);
    const result = await sandboxes.run(
      task('escape', [join(secrets, 'key'), repo, String(upstreamPort)], {
        sandbox: 'offline',
        workdir: work,
        env: { TASK: 'escape' },
        limits: { openFiles: 200, processes: 300, fileBytes: 1_000_000 },
      }),
    );
    expect(result.stderr).toBe('');
    const seen = output(result.stdout);
    expect(seen.secret).toEqual({ ok: false, code: 'ENOENT' });
    expect([seen.passwd, seen.shadow, seen.home]).toEqual([false, false, false]);
    expect(seen.writeReadOnly).toEqual({ ok: false, code: 'EROFS' });
    expect(seen.writeWork.ok).toBe(true);
    expect(await readFile(join(work, 'written'), 'utf8')).toBe('x');
    // Its own PID namespace: bubblewrap's init, the launcher and the probe.
    expect(seen.processes).toBeLessThanOrEqual(4);
    // Bubblewrap sets PWD for --chdir; nothing else from the host.
    expect(seen.env).toEqual([
      'TORTOISE_CONNECTION',
      'HOME',
      'LANG',
      'PATH',
      'PWD',
      'TASK',
      'TMPDIR',
    ]);
    expect(seen.undeclaredTool).toBe('ENOENT');
    expect(seen.limits).toEqual({
      'Max core file size': '0',
      'Max file size': '1000000',
      'Max processes': '300',
      'Max open files': '200',
    });
    // Only the API relay: this sandbox declares no destinations.
    expect(seen.sockets).toEqual(['api.sock']);
    // Its own network namespace: loopback only, and nothing listens there but the relays.
    expect(seen.interfaces).toEqual(['lo']);
    expect(seen.external).not.toBe('OPEN');
    expect(seen.hostLoopback).toBe('ECONNREFUSED');
    expect(seen.syscalls).toEqual({
      mount: 'errno 1',
      unshareUser: 'errno 1',
      unshareNet: 'errno 1',
      ptrace: 'errno 1',
      chroot: 'errno 1',
    });
  });

  test('an undeclared tool is refused before anything starts', async () => {
    await expect(
      sandboxes.run({ ...task('escape', []), command: ['git', 'status'] }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  test('network access goes only through the proxy, to declared destinations', async () => {
    const result = await sandboxes.run(task('proxy', [`127.0.0.1:${upstreamPort}`]));
    const { declared, undeclared } = output(result.stdout);
    expect(declared).toEqual({ status: 'HTTP/1.1 200 Connection Established', body: 'hello\n' });
    expect(undeclared.status).toBe('HTTP/1.1 403 Forbidden');
  });

  test('an expired grant and a revoked token stop the next call', async () => {
    const refused = { status: 403, body: { error: { message: 'Local session required' } } };
    const expiring = grant(['note.list'], { expiresAt: Date.now() + 400 });
    const expired = await sandboxes.run(task('later', ['900'], { context: expiring }));
    expect(output(expired.stdout)).toMatchObject(refused);

    const run = await sandboxes.start(task('later', ['600']));
    run.revoke();
    expect(output((await run.done).stdout)).toMatchObject(refused);

    const live = await sandboxes.run(task('later', ['0']));
    expect(output(live.stdout)).toMatchObject({ status: 200 });
    await expect(sandboxes.run(task('later', ['0'], { context: person('ann') }))).rejects.toThrow(
      'delegation grant',
    );
  });

  test('nothing the task leaves behind outlives the sandbox', async () => {
    const work = join(directory, 'linger');
    await mkdir(work);
    const result = await sandboxes.run(task('linger', [], { workdir: work }));
    expect(output(result.stdout)).toEqual({ left: true });
    await Bun.sleep(1_500);
    expect(existsSync(join(work, 'late'))).toBe(false);
  });

  test('output, wall time and cancellation stop the sandbox', async () => {
    const flood = await sandboxes.run(
      task('flood', ['5000000'], { limits: { outputBytes: 1_000 } }),
    );
    expect(flood).toMatchObject({ truncated: true, timedOut: false });
    expect(flood.stdout).toHaveLength(1_000);

    const spin = await sandboxes.run(task('spin', [], { limits: { wallMs: 700 } }));
    expect(spin).toMatchObject({ timedOut: true, exitCode: null });

    const controller = new AbortController();
    const running = sandboxes.run(task('spin', [], { signal: controller.signal }));
    setTimeout(() => controller.abort(), 300);
    expect(await running).toMatchObject({ cancelled: true, timedOut: false });
  });
});
