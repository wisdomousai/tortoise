import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditServiceOf } from '@tortoise/audit';
import { readEvents } from '@tortoise/event-log';
import { startHost } from '@tortoise/host/host';
import { hostContext } from '@tortoise/kernel/application';
import { LOCAL_OWNER } from '@tortoise/kernel/instance';
import type { TelemetryService } from '../src/plugin';
import { startCollector, telemetryApplication, type Received } from './fixtures';

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const owner = { principalId: LOCAL_OWNER, workspaceId: 'local' };
const SECRET = 'secret note text';

async function start(collector?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'deployment-policy.json'),
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      ...(collector ? { destinations: { telemetry: { url: collector } } } : {}),
    }),
  );
  const host = await startHost(telemetryApplication(), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'deployment-policy': join(directory, 'deployment-policy.json') },
  });
  cleanups.push(() => host.close());
  const telemetry = host.services.telemetry as TelemetryService;
  const command = async (operation: string, input: unknown, context = owner) =>
    host.application.invokeRaw({ operation, input, idempotencyKey: crypto.randomUUID() }, context);
  return { host, telemetry, command };
}

type Point = { attributes: { key: string; value: { stringValue: string } }[] } & Record<
  string,
  any
>;
const attributes = (point: Point) =>
  Object.fromEntries(point.attributes.map(({ key, value }) => [key, value.stringValue]));
function metric(received: readonly Received[], name: string): Point[] {
  const last = received.filter((entry) => entry.path === '/v1/metrics').at(-1)!;
  const found = last.body.resourceMetrics[0].scopeMetrics[0].metrics.find(
    (entry: { name: string }) => entry.name === name,
  );
  return found ? (found.sum ?? found.histogram ?? found.gauge).dataPoints : [];
}
const spansOf = (received: readonly Received[]) =>
  received
    .filter((entry) => entry.path === '/v1/traces')
    .flatMap((entry) => entry.body.resourceSpans[0].scopeSpans[0].spans as Point[]);

test('commands, deliveries, backlog and runs reach the collector through the network guard, without record contents', async () => {
  const collector = startCollector();
  cleanups.push(collector.stop);
  const { host, telemetry, command } = await start(collector.url);

  const first = await command('note.add', { text: SECRET });
  await command('note.add', { text: SECRET });
  await command('note.add', { text: SECRET }, { principalId: 'stranger', workspaceId: 'local' })
    .then(() => undefined)
    .catch((error) => error);
  const [effect] = first.effects!;
  await host.application.recordAttempt(hostContext('local'), effect!, 'timeout');
  await command('note.complete', { effectId: effect, status: 'accepted' });

  // A deterministic run, started over HTTP as a person would, adds one more note.
  const session = host.sessions.create(owner);
  const response = await fetch(`${host.url}/api/v1/runs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      harnessId: 'deterministic',
      prompt: JSON.stringify({
        commands: [{ operation: 'note.add', input: { input: { text: SECRET } } }],
      }),
    }),
  });
  expect(response.status).toBe(202);
  const { id: runId } = (await response.json()) as { id: string };
  for (let i = 0; i < 200 && (await host.supervisor.get(runId))?.state !== 'succeeded'; i++)
    await Bun.sleep(5);
  await Bun.sleep(20);

  await telemetry.flush();
  expect(telemetry.status().lastError).toBeUndefined();
  expect(telemetry.status().exports).toBe(1);

  const commands = metric(collector.received, 'tortoise.commands').map((point) => ({
    ...attributes(point),
    value: point.asInt,
  }));
  expect(commands).toContainEqual(
    expect.objectContaining({
      'tortoise.operation': 'note.add',
      'tortoise.outcome': 'committed',
      value: '2',
    }),
  );
  expect(commands).toContainEqual(
    expect.objectContaining({
      'tortoise.operation': 'note.add',
      'tortoise.outcome': 'denied',
      'error.type': 'FORBIDDEN',
    }),
  );
  expect(commands).toContainEqual(
    expect.objectContaining({ 'tortoise.channel': 'harness', value: '1' }),
  );
  const [delivery] = metric(collector.received, 'tortoise.delivery.duration');
  expect(attributes(delivery!)).toEqual({
    'tortoise.target': 'erp',
    'tortoise.effect.status': 'accepted',
  });
  expect(delivery!.count).toBe('1');
  expect(metric(collector.received, 'tortoise.delivery.attempts').map(attributes)).toEqual([
    { 'tortoise.target': 'erp', 'tortoise.attempt.result': 'retry' },
  ]);
  expect(
    metric(collector.received, 'tortoise.outbox.backlog').map((point): Record<string, string> => ({
      ...attributes(point),
      count: point.asInt,
    })),
  ).toEqual([{ 'tortoise.target': 'erp', 'tortoise.outbox.state': 'pending', count: '2' }]);
  expect(metric(collector.received, 'tortoise.runs').map(attributes)).toEqual([
    { 'tortoise.harness': 'deterministic', 'tortoise.run.state': 'succeeded' },
  ]);

  // The delivery span hangs under the command that enqueued it; the run's command under the run.
  const spans = spansOf(collector.received);
  const deliver = spans.find((span) => span.name === 'deliver erp')!;
  const parent = spans.find((span) => span.spanId === deliver.parentSpanId)!;
  expect(parent).toMatchObject({ name: 'note.add', traceId: deliver.traceId });
  const run = spans.find((span) => span.name === 'run')!;
  expect(
    spans.find(
      (span) =>
        span.parentSpanId === run.spanId && attributes(span)['tortoise.channel'] === 'harness',
    ),
  ).toMatchObject({ traceId: run.traceId, name: 'note.add' });
  // Five commands (one denied), one delivery and one run.
  expect(spans).toHaveLength(7);

  // Only identifiers from the catalog and the outbox leave: no text, resource, principal or ID.
  const sent = JSON.stringify(collector.received);
  const audit = auditServiceOf(host.services);
  const events = await readEvents(audit.logDirectory);
  for (const leak of [
    SECRET,
    'note-1',
    LOCAL_OWNER,
    'stranger',
    runId,
    effect!,
    ...events.flatMap((event) => (event.correlationId ? [event.correlationId] : [])),
  ])
    expect(sent).not.toContain(leak);
  // Each export was a guarded connection, recorded in the audit log.
  expect(
    events.filter(
      (event) => event.kind === 'network.completed' && event.data?.destination === 'telemetry',
    ).length,
  ).toBeGreaterThanOrEqual(2);
  expect(events.map((event) => event.kind)).toEqual(
    expect.arrayContaining(['run.started', 'run.ended']),
  );
});

test('a collector that is down loses no counts, and spans wait in a bounded buffer', async () => {
  const collector = startCollector();
  cleanups.push(collector.stop);
  const { telemetry, command } = await start(collector.url);
  collector.control.down = true;
  for (let i = 0; i < 5; i++) await command('note.add', { text: SECRET });
  await telemetry.flush();
  expect(telemetry.status().lastError).toBe('The collector returned 503 to /v1/metrics');
  for (let i = 0; i < 5; i++) await command('note.add', { text: SECRET });
  await telemetry.flush();
  // The buffer holds eight spans, so two of the ten commands' spans were dropped.
  expect(telemetry.status().droppedSpans).toBe(2);

  collector.control.down = false;
  await telemetry.flush();
  expect(telemetry.status()).toMatchObject({ exports: 1, lastError: undefined });
  expect(metric(collector.received, 'tortoise.commands').map((point) => point.asInt)).toEqual([
    '10',
  ]);
  expect(spansOf(collector.received)).toHaveLength(8);
});

test('without a bound collector the instance keeps working and reports why nothing is exported', async () => {
  const { telemetry, command } = await start();
  await command('note.add', { text: SECRET });
  await telemetry.flush();
  expect(telemetry.status().exports).toBe(0);
  expect(telemetry.status().lastError).toContain('telemetry');
  expect((await command('note.add', { text: SECRET })).effects).toHaveLength(1);
});
