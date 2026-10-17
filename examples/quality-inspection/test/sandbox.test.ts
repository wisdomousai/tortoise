import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Sandbox-first scenario: an agent drives the application over stdio MCP with an in-process
 * authority, then teardown drains the outbox. By default this runs the CLI from source; set
 * SANDBOX_BINARY=1 (`bun run test:sandbox`) to compile the single binary and run that instead,
 * with an empty environment, as a sandbox image would.
 */
const application = resolve(import.meta.dir, '..');
let directory = '';
let command: string[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-sandbox-'));
  if (process.env.SANDBOX_BINARY === '1') {
    // The shipped build configuration, not a copy of it.
    const { compileCli } = await import('../../../scripts/build-cli');
    command = [await compileCli(join(directory, 'app'), undefined, application)];
  } else {
    // The same static entry the binary compiles, run from source.
    const { writeApplicationEntry } = await import('../../../scripts/application-entry');
    command = [process.execPath, await writeApplicationEntry('cli', directory, application)];
  }
}, 120_000);
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const environment = (extra: Record<string, string> = {}) => ({ HOME: directory, ...extra });

async function run(args: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn([...command, ...args], {
    cwd: directory,
    env: environment(extra),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (stderr.trim()) console.error(stderr);
  return { exitCode, value: JSON.parse(stdout) };
}

test('an agent captures over embedded MCP, teardown drains, and metrics separate agent from human', async () => {
  const workspace = join(directory, 'workspace');
  const grantFile = join(directory, 'grant.json');
  // Written by the orchestrator, not the agent: the owner delegates capture at their plant only.
  await writeFile(
    grantFile,
    JSON.stringify({
      principalId: 'owner',
      operations: ['inspection.worklist', 'inspection.lot.get', 'inspection.result.record'],
      expiresAt: Date.now() + 3_600_000,
    }),
  );
  const transport = new StdioClientTransport({
    command: command[0]!,
    args: [
      ...command.slice(1),
      'mcp',
      '--embedded',
      '--workspace',
      workspace,
      '--grant-file',
      grantFile,
    ],
    cwd: directory,
    // The quality system is down for the whole session, so every capture stays in the outbox.
    env: environment({ DEMO_QUALITY_UNAVAILABLE: '1' }),
    stderr: 'pipe',
  });
  const agent = new Client({ name: 'deterministic-agent', version: '1.0.0' });
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  await agent.connect(transport);
  try {
    const tools = (await agent.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain('inspection_result_record');

    // The grant narrows the owner's authority: integration-only commands stay out of reach.
    const forbidden = await agent.callTool({
      name: 'inspection_sync_status',
      arguments: { input: {} },
    });
    expect(forbidden.isError).toBe(true);
    expect(decode(forbidden).error.code).toBe('FORBIDDEN');

    // Deterministic harness: follow the worklist until the diameter characteristic is complete.
    const recorded: string[] = [];
    let first: { input: unknown; idempotencyKey: string } | undefined;
    for (const value of [220.01, 219.98, 220.03]) {
      const worklist = decode(
        await agent.callTool({
          name: 'inspection_worklist',
          arguments: { input: { lotId: '4000001' } },
        }),
      ).data;
      expect(worklist.next.characteristicId).toBe('C10');
      const request = {
        input: {
          lotId: '4000001',
          characteristicId: worklist.next.characteristicId,
          sample: worklist.next.sample,
          value,
          occurredAt: Date.now(),
          capture: { durationMs: 300, input: 'instrument' },
        },
        idempotencyKey: `agent-${worklist.next.sample}`,
      };
      first ??= request;
      const receipt = decode(
        await agent.callTool({ name: 'inspection_result_record', arguments: request }),
      );
      expect(receipt.result.capture).toEqual({
        actor: 'agent',
        durationMs: 300,
        input: 'instrument',
      });
      recorded.push(receipt.result.id);
    }
    // A harness retrying after a lost response gets the original receipt, not a duplicate.
    const replay = decode(
      await agent.callTool({ name: 'inspection_result_record', arguments: first! }),
    );
    expect(replay.result.id).toBe(recorded[0]!);

    // One writer per workspace: a second embedded process is refused while the agent session runs.
    const concurrent = await run([
      'inspection',
      'worklist',
      '--embedded',
      '--workspace',
      workspace,
      '--lot-id',
      '4000001',
    ]);
    expect(concurrent.exitCode).toBe(5);
    expect(concurrent.value.error.code).toBe('CONFLICT');
  } finally {
    await agent.close();
  }

  // Teardown: the workspace lock is released when the MCP process exits.
  let pending = await run(['drain', '--workspace', workspace, '--timeout', '200'], {
    DEMO_QUALITY_UNAVAILABLE: '1',
  });
  for (let attempt = 0; pending.exitCode === 5 && attempt < 50; attempt++) {
    await Bun.sleep(100);
    pending = await run(['drain', '--workspace', workspace, '--timeout', '200'], {
      DEMO_QUALITY_UNAVAILABLE: '1',
    });
  }
  // A sandbox must not be discarded yet: three captured datapoints have not reached the SoR.
  // Every target the application declares is accounted for, including one with no work.
  const backlog = (quality: number) => ({
    pending: quality,
    targets: [
      { target: 'quality-system', pending: quality, held: 0, upstream: 0, deliverable: true },
    ],
  });
  expect(pending).toEqual({ exitCode: 75, value: backlog(3) });
  expect(await run(['drain', '--workspace', workspace, '--timeout', '5000'])).toEqual({
    exitCode: 0,
    value: backlog(0),
  });

  // A human operator on the same workspace, without a grant, through the generated subcommands.
  const human = await run([
    'inspection',
    'result',
    'record',
    '--embedded',
    '--workspace',
    workspace,
    '--lot-id',
    '4000001',
    '--characteristic-id',
    'C20',
    '--value',
    '22.01',
    '--occurred-at',
    String(Date.now()),
    '--key',
    'operator-1',
  ]);
  expect(human.exitCode).toBe(0);
  expect(human.value.result.capture).toEqual({ actor: 'human' });

  const metrics = await run([
    'inspection',
    'metrics',
    'summary',
    '--embedded',
    '--workspace',
    workspace,
  ]);
  expect(metrics.exitCode).toBe(0);
  expect(metrics.value.data).toMatchObject({
    datapoints: 4,
    agent: { count: 3, medianMs: 300 },
    human: { count: 1 },
    forwarding: { pending: 1, rejected: 0, accepted: { count: 3 } },
  });

  // Every process above wrote to one chained log. With no site policy the sandbox ran isolated,
  // and the log proves it: intact chain, isolated network, no egress attempted or denied.
  const auditLog = join(workspace, 'audit');
  const verified = await run(['audit', 'verify', '--log', auditLog]);
  expect(verified.exitCode).toBe(0);
  expect(verified.value).toMatchObject({ ok: true, problems: [] });
  const report = await run(['compliance', 'report', '--log', auditLog, '--format', 'json']);
  expect(report.exitCode).toBe(0);
  expect(report.value.posture).toMatchObject({ networkMode: 'isolated', log: { verified: true } });
  for (const destination of report.value.posture.destinations)
    expect(destination).toMatchObject({ allowed: 0, denied: 0 });
}, 60_000);

test('serve issues a grant-bound connection for an agent running as another OS user', async () => {
  const workspace = join(directory, 'served');
  const grantFile = join(directory, 'agent-grant.json');
  const agentConnection = join(directory, 'agent-connection.json');
  await writeFile(
    grantFile,
    JSON.stringify({ principalId: 'owner', operations: ['inspection.lot.list'] }),
  );
  const server = Bun.spawn(
    [
      ...command,
      'serve',
      '--workspace',
      workspace,
      '--port',
      '0',
      '--grant-file',
      grantFile,
      '--grant-connection',
      agentConnection,
    ],
    { cwd: directory, env: environment(), stdout: 'pipe', stderr: 'pipe' },
  );
  try {
    const reader = server.stdout.getReader();
    const { value } = await reader.read();
    const listening = JSON.parse(new TextDecoder().decode(value).split('\n')[0]!);
    expect(listening).toMatchObject({ type: 'listening', agentConnectionFile: agentConnection });
    reader.releaseLock();
    expect((await Bun.file(agentConnection).stat()).mode & 0o777).toBe(0o600);

    const lots = await run(['inspection', 'lot', 'list', '--connection', agentConnection]);
    expect(lots.exitCode).toBe(0);
    // The session carries the grant, so the agent cannot widen it with flags or by asking.
    const denied = await run(['inspection', 'metrics', 'summary', '--connection', agentConnection]);
    expect(denied).toMatchObject({ exitCode: 4, value: { error: { code: 'FORBIDDEN' } } });
    const forged = await run([
      'inspection',
      'lot',
      'list',
      '--connection',
      agentConnection,
      '--grant-file',
      grantFile,
    ]);
    expect(forged.exitCode).toBe(2);
    // Discovery reflects the delegation, so --dry-run can refuse without touching data.
    const dryRun = await run([
      'inspection',
      'metrics',
      'summary',
      '--connection',
      agentConnection,
      '--dry-run',
    ]);
    expect(dryRun).toMatchObject({ exitCode: 4, value: { error: { code: 'FORBIDDEN' } } });
  } finally {
    server.kill('SIGTERM');
    await server.exited;
  }
  // Credentials do not outlive the authority.
  expect(await Bun.file(agentConnection).exists()).toBe(false);
}, 60_000);
