import { describe, expect, test } from 'bun:test';
import { createFakeDriver } from '@agent-native/connector-driver/testing';
import { stationAutomationContract } from '../contracts/automation';
import { automationRoute, supervisor } from './automation-route';

/**
 * The domain scenarios of the screen route, with the station reached through its automation
 * interface instead: an in-process fake of the station automation driver behind the real
 * supervisor and connector. Nothing in the domain knows which route is in use.
 */
async function setup() {
  // `jam`: the station takes the load request but does not show the new recipe.
  const station = { jam: false };
  const driver = createFakeDriver({
    contract: stationAutomationContract,
    state: {
      machine: 'RUNNING',
      alarm: '',
      recipe: 'R-250',
      good: 1200,
      scrap: 3,
      control: 'remote',
    },
    devices: [{ serial: 'WINDER-1', firmware: '4.2' }],
    actions: {
      'recipe.load': (input, fake) => {
        if (!station.jam) fake.state.recipe = (input as { recipe: string }).recipe;
      },
    },
  });
  const route = await automationRoute({
    start: driver.start,
    stopMachine: () => {
      driver.state.machine = 'STOPPED';
    },
  });
  return { ...route, driver, station };
}

describe('winder through its automation interface', () => {
  test('the driver reports the station with provenance; stops open and close', async () => {
    const env = await setup();
    const { driver, observe, query } = env;
    await observe();
    let station = await query('line.station.get', { station: 'winder-1' });
    expect(station.readings.machine).toMatchObject({
      value: 'RUNNING',
      source: 'driver.station-automation',
      status: 'observed',
      profile: { id: 'station-automation', version: '1.0.0' },
    });
    expect(station.readings.good).toMatchObject({ value: 1200, confidence: 1 });
    expect(station.readings.control).toBeUndefined();
    expect(station.bridge).toMatchObject({ screen: null, profile: { id: 'station-automation' } });

    driver.state.machine = 'ALARM';
    driver.state.alarm = 'E-214 Wire break at tensioner';
    await observe();
    station = await query('line.station.get', { station: 'winder-1' });
    expect(station.currentStop).toMatchObject({
      state: 'ALARM',
      alarm: 'E-214 Wire break at tensioner',
    });

    driver.state.machine = 'RUNNING';
    await observe();
    const stops = await query('line.stop.list', { station: 'winder-1' });
    expect(stops.items).toHaveLength(1);
    expect(stops.items[0].endedAt).toBeGreaterThan(stops.items[0].startedAt);
    await env.close();
  });

  test('starting an order loads the recipe through the driver, accepted by readback', async () => {
    const env = await setup();
    const { driver, command, query, observe, deliver, ready } = env;
    await ready();
    const started = await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    expect(started.result.desired).toMatchObject({ recipe: 'R-100', sync: 'pending' });
    expect(await deliver()).toMatchObject({ accepted: 1 });
    expect(driver.state.recipe).toBe('R-100');
    await observe(1);
    const station = await query('line.station.get', { station: 'winder-1' });
    expect(station.desired).toMatchObject({ sync: 'accepted', converged: true });
    expect(station.order).toMatchObject({ id: 'ORD-7002', status: 'active' });
    await env.close();
  });

  test('monitor-only, the operator seat and local control keep effects pending without acting', async () => {
    const env = await setup();
    const { driver, command, deliver, ready } = env;
    await ready();
    await command(
      'line.bridge.set-mode',
      { station: 'winder-1', mode: 'monitor-only' },
      supervisor,
    );
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    expect(await deliver()).toMatchObject({ retried: 1, accepted: 0 });
    await command('line.bridge.set-mode', { station: 'winder-1', mode: 'actuate' }, supervisor);
    await command('line.seat.request', { station: 'winder-1', seat: 'operator' });
    expect(await deliver()).toMatchObject({ retried: 1, held: 0 });
    await command('line.seat.request', { station: 'winder-1', seat: 'agent' });
    driver.state.control = 'local';
    expect(await deliver()).toMatchObject({ retried: 1, held: 0 });
    expect(driver.applied('effect-1')).toBe(0);
    expect(driver.state.recipe).toBe('R-250');
    // Nothing was touched, so handing back delivers instead of holding.
    driver.state.control = 'remote';
    expect(await deliver()).toMatchObject({ accepted: 1 });
    await env.close();
  });

  test('a lost reply is read back: accepted when the station shows the recipe', async () => {
    const env = await setup();
    const { driver, command, deliver, ready } = env;
    await ready();
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    driver.crashNext();
    expect(await deliver()).toMatchObject({ retried: 1 });
    expect(await deliver()).toMatchObject({ accepted: 1 });
    expect(driver.applied('effect-1')).toBe(1);
    await env.close();
  });

  test('a lost reply the station does not show is held until a person reconciles it', async () => {
    const env = await setup();
    const { driver, station, command, query, deliver, ready } = env;
    await ready();
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    station.jam = true;
    driver.crashNext();
    expect(await deliver()).toMatchObject({ retried: 1 });
    expect(await deliver()).toMatchObject({ held: 1 });
    const [item] = (await query('line.attention.list', { station: 'winder-1' })).items;
    expect(item).toMatchObject({ kind: 'reconcile', effectId: 'effect-1' });
    expect((await query('line.station.get', { station: 'winder-1' })).desired).toMatchObject({
      sync: 'held',
    });
    // Held: never redelivered on its own.
    expect(await deliver()).toMatchObject({ accepted: 0, held: 0 });
    station.jam = false;
    await command('line.effect.reconcile', { effectId: item.effectId, applied: false });
    expect(await deliver()).toMatchObject({ accepted: 1 });
    expect(driver.state.recipe).toBe('R-100');
    await env.close();
  });
});
