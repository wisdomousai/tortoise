import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditServiceOf } from '@tortoise/audit';
import { readEvents } from '@tortoise/event-log';
import { startHost } from '@tortoise/host/host';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/host';
import type { TelemetryService } from '@tortoise/telemetry/plugin';
import { startCollector } from '@tortoise/telemetry/testing';
import { createTestRequestsOperationsApplication } from '../application';

const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER };
const SAMPLE = 'OS-24-0417';
const DESCRIPTION = 'Drawn from the bottom valve of T2, Substation Nord';

test('test request commands reach the collector as counts, and the export is in the audit log', async () => {
  const collector = startCollector();
  cleanup.push(collector.stop);
  const directory = await mkdtemp(join(tmpdir(), 'pattern-operations-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  // The same shape as site-policy.dev.json, bound to this test's collector.
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      destinations: { telemetry: { url: collector.url } },
    }),
  );
  const host = await startHost(
    createTestRequestsOperationsApplication({
      members: { viewer: 'viewer' },
      telemetryIntervalMs: 3_600_000,
    }),
    {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings: { 'site-policy': policy },
    },
  );
  cleanup.push(() => host.close());
  const submit = (context = localUser) =>
    host.application.invokeRaw(
      {
        operation: 'test-request.submit',
        input: { sample: SAMPLE, transformer: 'TR-40517', description: DESCRIPTION },
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );

  const submitted = await submit();
  const refused = await submit({ ...localUser, principalId: 'viewer' }).catch(
    (error: unknown) => error,
  );
  expect(refused).toBeInstanceOf(Error);

  const telemetry = host.services.telemetry as TelemetryService;
  await telemetry.flush();
  expect(telemetry.status().lastError).toBeUndefined();

  const metrics = collector.received.filter((entry) => entry.path === '/v1/metrics').at(-1)!;
  const commands = metrics.body.resourceMetrics[0].scopeMetrics[0].metrics.find(
    (metric: { name: string }) => metric.name === 'tortoise.commands',
  );
  const points = commands.sum.dataPoints.map(
    (point: { attributes: { key: string; value: { stringValue: string } }[]; asInt: string }) => ({
      ...Object.fromEntries(point.attributes.map(({ key, value }) => [key, value.stringValue])),
      count: point.asInt,
    }),
  );
  expect(points).toContainEqual(
    expect.objectContaining({
      'tortoise.operation': 'test-request.submit',
      'tortoise.outcome': 'committed',
      count: '1',
    }),
  );
  expect(points).toContainEqual(
    expect.objectContaining({
      'tortoise.operation': 'test-request.submit',
      'tortoise.outcome': 'denied',
    }),
  );

  // Operation names and outcomes leave; request contents, identifiers and principals do not.
  const sent = JSON.stringify(collector.received);
  const requestId = (submitted.result as { id: string }).id;
  for (const leak of [SAMPLE, DESCRIPTION, requestId, LOCAL_USER, 'viewer'])
    expect(sent).not.toContain(leak);

  const events = await readEvents(auditServiceOf(host.services).logDirectory);
  expect(
    events.some(
      (event) => event.kind === 'network.completed' && event.data?.destination === 'telemetry',
    ),
  ).toBe(true);
});
