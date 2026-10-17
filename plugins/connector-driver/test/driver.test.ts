import { describe, expect, test } from 'bun:test';
import { jsonSchema } from '@agent-native/contracts';
import { DeliveryFailure, DeliveryUncertain } from '@agent-native/integration';
import { conformanceEffect } from '@agent-native/testing/connectors';
import { z } from 'zod';
import { defineDriverContract, driverComponent, driverContractDocument } from '../src/contracts';
import { createDriverSupervisor, driverContractDigest } from '../src/supervisor';
import { chamber, chamberConnector, chamberDriver } from './fixture';

const effect = (type: string, payload: object, id = `${type}-1`) =>
  conformanceEffect({ id, target: 'chamber', type, payload: payload as never });
const signal = () => new AbortController().signal;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('driver contracts', () => {
  const action = {
    title: 'Move',
    input: jsonSchema(z.strictObject({})),
    hazard: 'low' as const,
    timeoutMs: 100,
  };
  const base = {
    id: 'axis',
    version: '1',
    title: 'Axis',
    process: { id: 'axis-driver', purpose: 'Axis', availability: 'optional' as const },
    state: { position: { type: 'number' as const } },
  };

  test('a contract is refused when its delivery modes cannot be honored', () => {
    expect(() =>
      defineDriverContract({ ...base, actions: { move: { ...action, delivery: 'convergent' } } }),
    ).toThrow('convergent without a readback');
    expect(() =>
      defineDriverContract({ ...base, actions: { move: { ...action, delivery: 'once' } } }),
    ).toThrow('the driver has no lookup');
    expect(() =>
      defineDriverContract({
        ...base,
        actions: {
          move: {
            ...action,
            delivery: 'convergent',
            readback: [{ field: 'speed', equals: 1 }],
          },
        },
      }),
    ).toThrow('undeclared state speed');
  });

  test('the digest covers the document, and the component declares the process and devices', () => {
    const document = driverContractDocument(chamber);
    expect(document).toMatchObject({ protocol: '1', id: 'chamber', lookup: true });
    expect(
      (document.actions as Record<string, { input: unknown }>)['setpoint.set']!.input,
    ).toMatchObject({
      type: 'object',
    });
    const changed = defineDriverContract({ ...chamber, version: '1.0.1' });
    expect(driverContractDigest(changed)).not.toBe(driverContractDigest(chamber));
    expect(driverComponent(chamber).requirements).toMatchObject({
      processes: [{ id: 'chamber-driver', executable: 'configured', network: [] }],
      devices: [{ id: 'chamber-port', kind: 'serial' }],
    });
  });
});

describe('driver supervisor', () => {
  test('a driver built for another contract is refused at the handshake and backs off', async () => {
    const driver = chamberDriver({ digest: '0'.repeat(64) });
    const supervisor = createDriverSupervisor({
      contract: chamber,
      start: driver.start,
      mode: () => 'actuate',
      backoff: { minMs: 60_000, maxMs: 60_000 },
    });
    await expect(supervisor.read(['setpoint'])).rejects.toMatchObject({ kind: 'protocol' });
    expect(supervisor.status()).toMatchObject({
      state: 'backing-off',
      lastError: expect.stringContaining('another contract'),
    });
    await expect(supervisor.read(['setpoint'])).rejects.toMatchObject({ kind: 'transient' });
    expect(driver.starts).toBe(1);
  });

  test('a restart starts a new session; events are ordered and gaps are reported', async () => {
    const driver = chamberDriver();
    const sessions: string[] = [];
    const events: unknown[] = [];
    const problems: string[] = [];
    const supervisor = createDriverSupervisor({
      contract: chamber,
      start: driver.start,
      mode: () => 'monitor-only',
      backoff: { minMs: 0, maxMs: 0 },
      onSession: (hello) => sessions.push(hello.session),
      onEvent: (event, hello) =>
        void events.push([event.name, event.payload, hello.devices[0]?.serial]),
      onProblem: (problem) => problems.push(problem),
    });
    expect((await supervisor.read(['setpoint', 'door'])).values).toEqual({
      setpoint: 20,
      door: 'closed',
    });
    driver.emit('reading', { setpoint: 20 });
    driver.emit('reading', { setpoint: 21 }, 2);
    await settle();
    expect(events).toEqual([
      ['reading', { setpoint: 20 }, 'CH-0042'],
      ['reading', { setpoint: 21 }, 'CH-0042'],
    ]);
    expect(problems).toEqual(['Driver events 1 to 2 were missed']);
    driver.crash();
    await settle();
    expect(supervisor.status().state).toBe('stopped');
    await supervisor.read(['setpoint']);
    expect(sessions).toEqual(['s1', 's2']);
    await supervisor.close();
  });

  test('a request in flight when the driver exits fails as exited; a hung one can be cancelled', async () => {
    const { driver, supervisor } = chamberConnector();
    driver.crashNext();
    await expect(supervisor.invoke('label.print', { text: 'x' }, 'e1')).rejects.toMatchObject({
      kind: 'exited',
    });
    driver.hangNext();
    const controller = new AbortController();
    const pending = supervisor.invoke('label.print', { text: 'y' }, 'e2', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    await supervisor.close();
  });
});

describe('driver connector', () => {
  test('monitor-only is refused by the host, and by the driver if the host lets it through', async () => {
    const host = chamberConnector('monitor-only');
    await expect(host.port.deliver(effect('label.print', { text: 'x' }), signal())).rejects.toThrow(
      'monitor-only',
    );
    expect(host.driver.applied('label.print-1')).toBe(0);
    await expect(host.supervisor.invoke('label.print', { text: 'x' }, 'e1')).rejects.toMatchObject({
      kind: 'refused',
    });
    await host.supervisor.close();
    const assist = chamberConnector('assist');
    await expect(
      assist.port.deliver(effect('setpoint.set', { setpoint: 50 }), signal()),
    ).rejects.toThrow('needs actuate mode');
    await assist.supervisor.close();
  });

  test('an operator-present action needs confirmation at the machine', async () => {
    const { port, supervisor } = chamberConnector();
    expect(await port.deliver(effect('cycle.start', { program: 'p' }), signal())).toMatchObject({
      status: 'rejected',
      code: 'PRECONDITION',
    });
    expect(
      await port.deliver(
        effect('cycle.start', { program: 'p', presence: { confirmedBy: 'ina' } }, 'c2'),
        signal(),
      ),
    ).toEqual({ status: 'accepted', externalRef: 'cycle-1' });
    await supervisor.close();
  });

  test('a convergent action is accepted without acting when the equipment already shows it', async () => {
    const { port, driver, supervisor } = chamberConnector();
    expect(await port.deliver(effect('setpoint.set', { setpoint: 20 }), signal())).toEqual({
      status: 'accepted',
    });
    expect(driver.applied('setpoint.set-1')).toBe(0);
    await supervisor.close();
  });

  test('local control and an open door stop a convergent action before it acts', async () => {
    const { port, driver, supervisor } = chamberConnector();
    driver.state.control = 'local';
    await expect(port.deliver(effect('setpoint.set', { setpoint: 50 }), signal())).rejects.toThrow(
      'under local control',
    );
    driver.state.control = 'remote';
    driver.state.door = 'open';
    expect(
      await port.deliver(effect('setpoint.set', { setpoint: 50 }, 's2'), signal()),
    ).toMatchObject({
      status: 'rejected',
      code: 'PRECONDITION',
      message: 'Set the setpoint not possible: door is open',
    });
    expect(driver.state.setpoint).toBe(20);
    await supervisor.close();
  });

  test('a driver that reports uncertain is held; a lost once-reply is found by lookup', async () => {
    const { port, driver, supervisor } = chamberConnector();
    driver.failNext('uncertain');
    const started = effect('cycle.start', { program: 'p', presence: { confirmedBy: 'ina' } });
    await expect(port.deliver(started, signal())).rejects.toBeInstanceOf(DeliveryUncertain);
    const lost = effect('cycle.start', { program: 'q', presence: { confirmedBy: 'ina' } }, 'c2');
    driver.crashNext();
    const error = await port.deliver(lost, signal()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeliveryFailure);
    expect(error).not.toBeInstanceOf(DeliveryUncertain);
    expect(await port.lookup!(lost.id, signal(), { ...lost, attempts: 1 })).toEqual({
      status: 'accepted',
      externalRef: 'cycle-1',
    });
    expect(driver.applied('c2')).toBe(1);
    await supervisor.close();
  });
});
