import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExecutionHost } from '@agent-native/execution-host/run';
import { startHost } from '@agent-native/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { createLabRequestsSandboxApplication } from '../application';
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
    createLabRequestsSandboxApplication({ members: { ana: 'technician', ben: 'viewer' } }),
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
  const owner = (path: string, body?: unknown) =>
    fetch(new URL(path, host.url), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { host, command, owner };
}

test('the statistics are the count, mean, range and pattern standard deviation', () => {
  expect(summarize([412, 405, 418, 409])).toEqual({
    count: 4,
    mean: 411,
    min: 405,
    max: 418,
    stdev: 5.48,
  });
  expect(summarize([400]).stdev).toBe(0);
});

test('technicians record readings for a submitted request and enter statistics by hand', async () => {
  const { command } = await serve();
  const submitted = await command(
    'test-request.submit',
    { specimen: 'B-1042-03', description: 'Tensile strength of the weld coupon' },
    'ana',
  );
  const request = (submitted.result as { id: string }).id;
  const recorded = await command(
    'test-result.record',
    { request, readings: [412, 405, 418] },
    'ana',
  );
  expect(recorded.result).toMatchObject({ request, recordedBy: 'ana' });
  const id = (recorded.result as { id: string }).id;

  await expect(
    command('test-result.record', { request, readings: [400] }, 'ben'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    command('test-result.record', { request: 'missing', readings: [400] }, 'ana'),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Statistics entered outside a run record no run.
  const entered = await command(
    'test-result.analyze',
    { id, ...summarize([412, 405, 418]) },
    'ana',
  );
  expect(entered.result).toMatchObject({ analysis: { count: 3, mean: 411.67 } });
  expect(entered.result).not.toHaveProperty('analysisRun');
  await expect(
    command('test-result.analyze', { id, ...summarize([400]) }, 'ben'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('without bubblewrap the status route says why, and a run is refused as unavailable', async () => {
  const { host, owner } = await serve();
  const sandboxes = host.services['execution-host'] as ExecutionHost;
  const status = await (await owner(resultAnalysisPaths.status)).json();
  expect(status).toEqual(sandboxes.availability(ANALYSIS_SANDBOX));
  expect(status.available).toBe(false);
  if (process.platform !== 'linux') expect(status.reason).toContain('Linux bubblewrap');

  const refused = await owner(resultAnalysisPaths.run, { result: 'any' });
  expect(refused.status).toBe(503);
  expect(await refused.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
});

test('the sandbox sees no workspace of the checkout, so no owner connection file', () => {
  const pattern = resolve(import.meta.dir, '..');
  const checkout = resolve(pattern, '../..');
  for (const workspace of [
    join(pattern, '.workspace'),
    join(checkout, 'examples/fleet/.workspace'),
    join(checkout, '.workspace'),
  ])
    expect(analysisReadOnly.some((path) => `${workspace}/`.startsWith(`${path}/`))).toBe(false);
});
