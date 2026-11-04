import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExecutionHost } from '@tortoise/execution-host/run';
import { startHost } from '@tortoise/host/host';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { createTestRequestsSandboxApplication } from '../application';
import { analysisReadOnly } from '../plugins/result-analysis/plugin';
import { ANALYSIS_SANDBOX, resultAnalysisPaths } from '../plugins/result-analysis/plugin-manifest';
import { summarize } from '../tools/statistics';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A serving host with no policy, so no bubblewrap is bound on any platform. */
async function serve() {
  const directory = await mkdtemp(join(tmpdir(), 'lab-sandbox-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost(
    createTestRequestsSandboxApplication({ members: { ana: 'technician', ben: 'viewer' } }),
    { workspacePath: join(directory, 'workspace'), integration: false },
  );
  cleanups.push(() => host.close());
  const { token } = JSON.parse(await readFile(host.connectionFile!, 'utf8')) as { token: string };
  const as = (principalId: string) => ({ workspaceId: LOCAL_WORKSPACE, principalId });
  const command = (operation: string, input: unknown, principalId: string) =>
    host.application.invokeRaw(
      { operation, input, idempotencyKey: crypto.randomUUID() },
      as(principalId),
    );
  const localUser = (path: string, body?: unknown) =>
    fetch(new URL(path, host.url), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { host, command, localUser };
}

test('the statistics are the count, mean, range and sample standard deviation', () => {
  expect(summarize([62, 55, 68, 59])).toEqual({
    count: 4,
    mean: 61,
    min: 55,
    max: 68,
    stdev: 5.48,
  });
  expect(summarize([60]).stdev).toBe(0);
});

test('technicians record readings for a submitted request and enter statistics by hand', async () => {
  const { command } = await serve();
  const submitted = await command(
    'test-request.submit',
    {
      sample: 'OS-24-0417',
      transformer: 'TR-40517',
      description: 'Gas alarm after a load increase',
    },
    'ana',
  );
  const request = (submitted.result as { id: string }).id;
  const recorded = await command('test-result.record', { request, readings: [62, 55, 68] }, 'ana');
  expect(recorded.result).toMatchObject({ request, recordedBy: 'ana' });
  const id = (recorded.result as { id: string }).id;

  await expect(
    command('test-result.record', { request, readings: [60] }, 'ben'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    command('test-result.record', { request: 'missing', readings: [60] }, 'ana'),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Statistics entered outside a run record no run.
  const entered = await command('test-result.analyze', { id, ...summarize([62, 55, 68]) }, 'ana');
  expect(entered.result).toMatchObject({ analysis: { count: 3, mean: 61.67 } });
  expect(entered.result).not.toHaveProperty('analysisRun');
  await expect(
    command('test-result.analyze', { id, ...summarize([60]) }, 'ben'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('without bubblewrap the status route says why, and a run is refused as unavailable', async () => {
  const { host, localUser } = await serve();
  const sandboxes = host.services['execution-host'] as ExecutionHost;
  const status = await (await localUser(resultAnalysisPaths.status)).json();
  expect(status).toEqual(sandboxes.availability(ANALYSIS_SANDBOX));
  expect(status.available).toBe(false);
  if (process.platform !== 'linux') expect(status.reason).toContain('Linux bubblewrap');

  const refused = await localUser(resultAnalysisPaths.run, { result: 'any' });
  expect(refused.status).toBe(503);
  expect(await refused.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
});

test('the sandbox sees no workspace of the checkout, so no local-user connection file', () => {
  const pattern = resolve(import.meta.dir, '..');
  const checkout = resolve(pattern, '../..');
  for (const workspace of [
    join(pattern, '.workspace'),
    join(checkout, 'showcase/examples/fleet/.workspace'),
    join(checkout, '.workspace'),
  ])
    expect(analysisReadOnly.some((path) => `${workspace}/`.startsWith(`${path}/`))).toBe(false);
});
