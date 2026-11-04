import { describe, expect, test } from 'bun:test';
import { buildCatalog, defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import type { HostPorts } from '@tortoise/host/plugin';
import { z } from 'zod';
import type { CommandResult, ExecutionContext, Invocation } from '@tortoise/runtime';
import { createDriverObserver } from '../src/connect';
import { defineDriverContract, driverOperations } from '../src/contracts';
import { driverServiceOf, openDrivers } from '../src/open';
import { driverPluginManifest } from '../src/plugin-manifest';
import { createDriverHandlers, createDriverState, driverPolicy } from '../src/server';
import { createDriverSupervisor } from '../src/supervisor';
import { createFakeDriver } from '../src/testing';
import { chamber, chamberDriver } from './fixture';

const complete = () => new Promise((resolve) => setTimeout(resolve, 5));
const context: ExecutionContext = { workspaceId: 'w', principalId: 'observer' };
const portsFor = (start: () => Promise<unknown>) =>
  ({ processes: { spawn: async () => start() } }) as unknown as HostPorts;

/** A chamber whose setpoint needs two agreeing reads. */
const steady = defineDriverContract({
  ...chamber,
  state: { ...chamber.state, setpoint: { ...chamber.state.setpoint!, stableReads: 2 } },
});

function recorder() {
  const submitted: Invocation[] = [];
  return {
    submitted,
    application: {
      async invokeRaw(request: Invocation) {
        submitted.push(request);
        return { result: {}, revision: submitted.length } as unknown as CommandResult;
      },
    },
  };
}

describe('driver observer', () => {
  test('readings carry the unit the driver reported, and a restart restarts every count', async () => {
    const driver = createFakeDriver({
      contract: steady,
      state: { setpoint: 20, door: 'closed', control: 'remote' },
      devices: [{ serial: 'CH-0042', firmware: '3.1' }],
    });
    const supervisor = createDriverSupervisor({
      contract: steady,
      start: driver.start,
      backoff: { minMs: 0, maxMs: 0 },
    });
    const { application, submitted } = recorder();
    let clock = 1_000;
    const observer = createDriverObserver({
      contract: steady,
      supervisor,
      fields: ['setpoint', 'door'],
      application,
      context,
      ingestOperation: 'chamber.observe',
      now: () => clock,
    });
    const first = (await observer.runOnce()).observation;
    expect(first.readings.map((reading) => reading.field)).toEqual(['door']);
    expect(first.readings[0]).toMatchObject({
      status: 'observed',
      extractor: 'driver.chamber',
      device: { driver: 'fake-chamber', driverVersion: '0.0.0', serial: 'CH-0042' },
      observedAt: 1_000,
    });
    clock += 10;
    expect((await observer.runOnce()).observation.readings.map((item) => item.field)).toEqual([
      'setpoint',
      'door',
    ]);
    driver.crash();
    await complete();
    const restarted = (await observer.runOnce()).observation;
    expect(restarted.session).toBe('s2');
    expect(restarted.readings.map((reading) => reading.field)).toEqual(['door']);
    expect(submitted[0]!.idempotencyKey).toStartWith('observe:driver.chamber:');
    await supervisor.close();
  });

  test('a value outside its declaration is uncertain, never observed', async () => {
    const driver = chamberDriver();
    const supervisor = createDriverSupervisor({ contract: chamber, start: driver.start });
    driver.state.door = 'ajar';
    const observer = createDriverObserver({
      contract: chamber,
      supervisor,
      fields: ['door'],
      ...recorder(),
      context,
      ingestOperation: 'chamber.observe',
    });
    expect((await observer.runOnce()).observation.readings).toMatchObject([
      { field: 'door', value: null, confidence: 0, status: 'uncertain' },
    ]);
    expect(() =>
      createDriverObserver({
        contract: chamber,
        supervisor,
        fields: ['speed'],
        ...recorder(),
        context,
        ingestOperation: 'chamber.observe',
      }),
    ).toThrow('no state speed');
    await supervisor.close();
  });
});

describe('driver plugin', () => {
  test('the manifest declares each driver once, with its process and devices', () => {
    const manifest = driverPluginManifest([chamber]);
    expect(manifest).toMatchObject({ id: 'driver', modules: [{ id: 'driver' }] });
    expect(manifest.components?.map((component) => component.id)).toEqual(['driver.chamber']);
    expect(manifest.modules[0]!.workflows![0]!.text).toContain(
      'cycle.start (Start a cycle): once, runs only in actuate mode with presence.confirmedBy',
    );
    expect(() => driverPluginManifest([chamber, chamber])).toThrow('declared twice');
  });

  test('a command forwarding to the driver composes, carried by the driver process', () => {
    const manifest = driverPluginManifest([chamber]);
    const forward = defineCapability({
      id: 'chamber.setpoint.request',
      kind: 'command',
      input: jsonSchema(z.strictObject({})),
      output: jsonSchema(z.strictObject({})),
      permission: { action: 'update', resourceType: 'Chamber' },
      ui: { exception: 'test' },
      integration: { target: 'chamber', delivery: 'outbox' },
    });
    const catalog = buildCatalog(
      [...manifest.modules, defineModule({ id: 'chamber', capabilities: [forward] })],
      { components: manifest.components ?? [] },
    );
    expect(catalog.operations.find((item) => item.id === forward.id)).toMatchObject({
      processes: ['chamber-driver'],
    });
  });

  test('the service starts a driver through the process port on first use and fans out events', async () => {
    const driver = chamberDriver();
    const instance = openDrivers(
      { contracts: [chamber], healthMs: 0, backoff: { minMs: 0, maxMs: 0 } },
      { ports: portsFor(driver.start) },
    );
    const service = driverServiceOf({ driver: instance.service });
    expect(service.status()).toMatchObject([{ id: 'chamber', state: 'stopped', starts: 0 }]);
    const seen: string[] = [];
    service.onEvent('chamber', () => {
      throw new Error('broken listener');
    });
    const stop = service.onEvent('chamber', (event) => void seen.push(event.name));
    const sessions: string[] = [];
    service.onSession('chamber', (session) => sessions.push(session.session));
    await service.supervisor('chamber').read(['setpoint']);
    driver.emit('reading', { setpoint: 20 });
    await complete();
    stop();
    driver.emit('reading', { setpoint: 21 });
    await complete();
    expect(seen).toEqual(['reading']);
    expect(sessions).toEqual(['s1']);
    expect(service.status()[0]).toMatchObject({
      state: 'ready',
      devices: [{ serial: 'CH-0042' }],
      actions: expect.arrayContaining([
        { id: 'cycle.start', title: 'Start a cycle', delivery: 'once', risk: 'operator-present' },
      ]),
    });
    expect(service.status()[0]!.problems).toBeGreaterThan(0);
    expect(() => service.supervisor('oven')).toThrow('No driver oven');
    await instance.close!();
    expect(() => driverServiceOf({})).toThrow('does not run the driver plugin');
  });

  test('only named readers see driver status, and a scoped grant must name it', async () => {
    const state = createDriverState(['local-user']);
    const capability = driverOperations.statusGet;
    const allowed = (ctx: ExecutionContext) =>
      driverPolicy.authorize({ capability, context: ctx, state } as never);
    expect(allowed({ workspaceId: 'w', principalId: 'local-user' })).toMatchObject({
      allowed: true,
    });
    expect(allowed({ workspaceId: 'w', principalId: 'agent' })).toMatchObject({ allowed: false });
    expect(
      allowed({
        workspaceId: 'w',
        principalId: 'local-user',
        grant: { operations: [capability.id], resources: ['order:1'] },
      } as ExecutionContext),
    ).toMatchObject({ allowed: false, reason: 'RESOURCE_DENIED' });
    const [handler] = createDriverHandlers();
    const instance = openDrivers({ contracts: [chamber] }, { ports: portsFor(async () => {}) });
    expect(
      await handler!.handle({}, { services: { driver: instance.service } } as never),
    ).toMatchObject({ drivers: [{ id: 'chamber', state: 'stopped' }] });
  });
});
