import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditServiceOf } from '@agent-native/audit';
import { readEvents } from '@agent-native/event-log';
import { startHost } from '@agent-native/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/host';
import type { TelemetryService } from '@agent-native/telemetry/plugin';
import { startCollector } from '@agent-native/telemetry/testing';
import { createTestRequestsOperationsApplication } from '../application';

const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const SPECIMEN = 'B-1042-03';
const DESCRIPTION = 'Weld coupon from line 2, heat lot 7731';

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
  const submit = (context = owner) =>
    host.application.invokeRaw(
      {
        operation: 'test-request.submit',
        input: { specimen: SPECIMEN, description: DESCRIPTION },
        idempotencyKey: crypto.randomUUID(),
      },
      context,
    );

  const submitted = await submit();
  const refused = await submit({ ...owner, principalId: 'viewer' }).catch(
    (error: unknown) => error,
  );
  expect(refused).toBeInstanceOf(Error);

  const telemetry = host.services.telemetry as TelemetryService;
  await telemetry.flush();
  expect(telemetry.status().lastError).toBeUndefined();

  const metrics = collector.received.filter((entry) => entry.path === '/v1/metrics').at(-1)!;
  const commands = metrics.body.resourceMetrics[0].scopeMetrics[0].metrics.find(
    (metric: { name: string }) => metric.name === 'agent_native.commands',
  );
  const points = commands.sum.dataPoints.map(
    (point: { attributes: { key: string; value: { stringValue: string } }[]; asInt: string }) => ({
      ...Object.fromEntries(point.attributes.map(({ key, value }) => [key, value.stringValue])),
      count: point.asInt,
    }),
  );
  expect(points).toContainEqual(
    expect.objectContaining({
      'agent_native.operation': 'test-request.submit',
      'agent_native.outcome': 'committed',
      count: '1',
    }),
  );
  expect(points).toContainEqual(
    expect.objectContaining({
      'agent_native.operation': 'test-request.submit',
      'agent_native.outcome': 'denied',
    }),
  );

  // Operation names and outcomes leave; request contents, identifiers and principals do not.
  const sent = JSON.stringify(collector.received);
  const requestId = (submitted.result as { id: string }).id;
  for (const leak of [SPECIMEN, DESCRIPTION, requestId, LOCAL_OWNER, 'viewer'])
    expect(sent).not.toContain(leak);

  const events = await readEvents(auditServiceOf(host.services).logDirectory);
  expect(
    events.some(
      (event) => event.kind === 'egress.completed' && event.data?.destination === 'telemetry',
    ),
  ).toBe(true);
});
