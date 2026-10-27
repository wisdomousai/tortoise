import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { openEmbeddedInstance } from '@agent-native/host';
import { createLabRequestsSignalsApplication } from '../application';
import type { Chamber } from '../contracts';
import { OBSERVER_PRINCIPAL, defaultChambers } from '../domain';
import { FakePlant } from '../fake-plant';
import { createChamberObservers } from '../observers';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const observer = {
  workspaceId: 'local',
  principalId: OBSERVER_PRINCIPAL,
  grant: { operations: ['chamber.reading.ingest'] },
};

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const until = async (condition: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(5);
  }
};

/**
 * An embedded instance, the plant stand-in on free ports and both chamber observers. The site
 * policy binds the gateway and the broker to the stand-in unless `bound` is false; the observers
 * reach them through the instance's network port, as the running host's do.
 */
async function open({ bound = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-lab-requests-signals-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const plant = new FakePlant(defaultChambers);
  const ports = plant.start();
  cleanup.push(() => plant.stop());
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      destinations: bound
        ? {
            'chamber-gateway': { url: `tcp://127.0.0.1:${ports.gateway}` },
            'chamber-broker': { url: `tcp://127.0.0.1:${ports.broker}` },
          }
        : {},
    }),
  );
  let next = 0;
  const instance = await openEmbeddedInstance(
    createLabRequestsSignalsApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `r${++next}` },
    }),
    { workspacePath: join(directory, 'workspace'), settings: { 'site-policy': policy } },
  );
  cleanup.push(() => instance.close());
  const observers = createChamberObservers({
    application: instance.application,
    workspaceId: 'local',
    network: instance.ports.network,
    chambers: defaultChambers,
    heartbeatMs: 1,
    retryMs: 20,
  });
  // Only the subscription runs in the background; the tests run each pass themselves, so the
  // stability gate sees exactly the reads a test makes.
  observers.humidity.start(60_000);
  cleanup.push(() => observers.stop());

  const { application } = instance;
  let key = 0;
  const command = async (operation: string, input: unknown, as: object = owner) =>
    (
      await application.invokeRaw(
        { operation, input, idempotencyKey: `k${++key}` },
        as as typeof owner,
      )
    ).result as Record<string, unknown>;
  const chambers = async (as = viewer) =>
    (
      (await application.queryRaw({ operation: 'chamber.list', input: {} }, as)).data as {
        items: Chamber[];
      }
    ).items;
  const chamber = async (id: string) => (await chambers()).find((item) => item.id === id)!;
  const observe = async () => {
    await observers.temperature.runOnce();
    await observers.humidity.runOnce();
  };
  return { application, plant, observers, command, chambers, chamber, observe };
}

const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );

test('temperature counts after two equal reads and humidity after a birth; a placed request shows its chamber', async () => {
  const { plant, observers, command, chamber, observe, application } = await open();
  const { id } = (await command('test-request.submit', {
    specimen: 'PA6-0417',
    description: 'Notched impact strength after conditioning',
    method: 'ISO 179 Charpy impact',
  })) as { id: string };
  await command('chamber.place', { request: id, chamber: 'chamber-1' });
  await until(() => observers.humidity.connected);

  plant.setTemperature('chamber-1', 23.4);
  await Bun.sleep(30);
  await observe();
  // One read of a temperature is not yet stable; the edge node's birth gave the humidity.
  expect(await chamber('chamber-1')).toMatchObject({
    temperature: null,
    humidity: { value: 50, status: 'observed' },
    conditioned: false,
  });
  await observe();
  const first = await chamber('chamber-1');
  expect(first.temperature).toMatchObject({ value: 23.4, status: 'observed' });
  expect(first.humidity).toMatchObject({ value: 50, status: 'observed' });
  expect(first.conditioned).toBe(true);

  const conditions = await application.queryRaw(
    { operation: 'chamber.conditions', input: { request: id } },
    viewer,
  );
  expect((conditions.data as { chamber: Chamber }).chamber).toMatchObject({
    id: 'chamber-1',
    conditioned: true,
  });

  // A humidity change outside the tolerance clears `conditioned` on the next pass.
  plant.setHumidity('chamber-1', 63);
  await Bun.sleep(30);
  await observe();
  expect(await chamber('chamber-1')).toMatchObject({
    humidity: { value: 63, status: 'observed' },
    conditioned: false,
  });
});

test('a dead edge node and a stopped gateway mark the last values uncertain', async () => {
  const { plant, observers, chamber, observe } = await open();
  await until(() => observers.humidity.connected);
  await Bun.sleep(30);
  await observe();
  await observe();
  expect((await chamber('chamber-2')).conditioned).toBe(true);

  plant.kill('chamber-2');
  plant.gateway.stop();
  await Bun.sleep(30);
  await observe();
  expect(await chamber('chamber-2')).toMatchObject({
    temperature: { value: 23, status: 'uncertain' },
    humidity: { value: 50, status: 'uncertain' },
    conditioned: false,
  });

  // A new birth makes the edge node current again; the gateway stays down.
  plant.revive('chamber-2');
  await Bun.sleep(30);
  await observe();
  expect(await chamber('chamber-2')).toMatchObject({
    temperature: { status: 'uncertain' },
    humidity: { value: 50, status: 'observed' },
  });
});

test('the observer principal only ingests, and neither observer writes to the plant', async () => {
  const { plant, observers, command, chambers, observe, application } = await open();
  await until(() => observers.humidity.connected);
  await observe();

  expect(
    await refused(application.queryRaw({ operation: 'chamber.list', input: {} }, observer)),
  ).toBe('FORBIDDEN');
  expect(
    await refused(application.queryRaw({ operation: 'test-request.list', input: {} }, observer)),
  ).toBe('FORBIDDEN');
  expect(
    await refused(command('chamber.place', { request: 'r1', chamber: 'chamber-1' }, observer)),
  ).toBe('FORBIDDEN');
  // People cannot submit readings, even a technician.
  expect(
    await refused(
      command('chamber.reading.ingest', { source: 'opcua', observedAt: 1, readings: [] }),
    ),
  ).toBe('FORBIDDEN');

  expect(plant.broker.published).toEqual([]);
  expect(plant.gateway.requests.filter((request) => request.startsWith('unsupported'))).toEqual([]);
  expect(await refused(chambers(stranger))).toBe('FORBIDDEN');
});

test('viewers read chambers but cannot place a specimen', async () => {
  const { command } = await open();
  const { id } = (await command('test-request.submit', {
    specimen: 'PA6-0418',
    description: 'Tensile modulus after conditioning',
    method: '',
  })) as { id: string };
  expect(
    await refused(command('chamber.place', { request: id, chamber: 'chamber-1' }, viewer)),
  ).toBe('FORBIDDEN');
  expect(await refused(command('chamber.place', { request: id, chamber: 'chamber-9' }))).toBe(
    'NOT_FOUND',
  );
});

test('without a site binding neither source is reached and no condition is recorded', async () => {
  const { plant, observe, chambers } = await open({ bound: false });
  await observe();
  await Bun.sleep(50);
  expect(plant.broker.connects).toEqual([]);
  expect(plant.gateway.hellos).toEqual([]);
  expect((await chambers()).map((item) => [item.temperature, item.humidity])).toEqual([
    [null, null],
    [null, null],
  ]);
});
