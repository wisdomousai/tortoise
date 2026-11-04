// The analysis in a real bubblewrap sandbox. Skipped without Linux and bubblewrap;
// `bun run test:execution-host:linux showcase/patterns/sandbox` runs it in a container.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionHost } from '@tortoise/execution-host/run';
import { startHost } from '@tortoise/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { createTestRequestsSandboxApplication } from '../application';
import { analyzeResult } from '../plugins/result-analysis/plugin';
import { resultAnalysisPaths } from '../plugins/result-analysis/plugin-manifest';
import { summarize } from '../tools/statistics';

const bwrap = process.env.BWRAP ?? '/usr/bin/bwrap';
const supported = process.platform === 'linux' && existsSync(bwrap);

type Host = Awaited<ReturnType<typeof startHost>>;
let host: Host;
let directory: string;
let token: string;
let request: string;

const as = (principalId: string) => ({ workspaceId: LOCAL_WORKSPACE, principalId });
const command = async (operation: string, input: unknown, principalId = LOCAL_OWNER) =>
  (
    await host.application.invokeRaw(
      { operation, input, idempotencyKey: crypto.randomUUID() },
      as(principalId),
    )
  ).result as Record<string, any>;
const result = async (id: string) =>
  (
    await host.application.queryRaw(
      { operation: 'test-result.get', input: { id } },
      as(LOCAL_OWNER),
    )
  ).data as Record<string, any>;

describe.skipIf(!supported)('analysis in a bubblewrap sandbox', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'lab-sandbox-'));
    const policy = join(directory, 'deployment-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        audit: { mode: 'best-effort' },
        processes: { 'analysis-tools': { executable: bwrap } },
      }),
    );
    host = await startHost(createTestRequestsSandboxApplication({ members: { ben: 'viewer' } }), {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings: { 'deployment-policy': policy },
    });
    ({ token } = JSON.parse(await readFile(host.connectionFile!, 'utf8')) as { token: string });
    request = (
      await command('test-request.submit', {
        sample: 'OS-24-0417',
        transformer: 'TR-40517',
        description: 'Gas alarm after a load increase',
      })
    ).id;
  });
  afterAll(async () => {
    await host?.close();
    await rm(directory, { recursive: true, force: true });
  });

  test('the owner starts a run from the route; its tool reads and records through the CLI', async () => {
    const readings = [62, 55, 68, 59];
    const { id } = await command('test-result.record', { request, readings });
    const response = await fetch(new URL(resultAnalysisPaths.run, host.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ result: id }),
    });
    const run = await response.json();
    expect(run).toMatchObject({ exitCode: 0, timedOut: false });
    expect(run.output.analysis).toEqual(summarize(readings));
    expect(run.output.revisions).toEqual({ [`test-result:${id}`]: 2 });
    // The handler took the run from the token's context, not from the tool's input.
    expect(await result(id)).toMatchObject({
      analysis: summarize(readings),
      analysisRun: run.runId,
    });
  });

  test("a viewer's run reads the result, and the policy refuses its analysis", async () => {
    const { id } = await command('test-result.record', { request, readings: [57, 61] });
    const run = await analyzeResult(
      host.services['execution-host'] as ExecutionHost,
      host.application.catalog,
      as('ben'),
      id,
    );
    expect(run.exitCode).toBe(1);
    expect(run.output).toMatchObject({ step: 'record', error: { code: 'FORBIDDEN' } });
    expect((await result(id)).analysis).toBeUndefined();
  });
});
