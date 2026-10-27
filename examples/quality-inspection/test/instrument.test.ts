import { describe, expect, test } from 'bun:test';
import { createEffectDispatcher } from '@agent-native/integration';
import { createFakeDriver } from '@agent-native/connector-driver/testing';
import { createQualityInspectionApplication } from '../application';
import { instrumentContract } from '../contracts/instrument';
import { INSTRUMENT_READING_LIMIT } from '../domain';
import {
  as,
  connectInstrument,
  device,
  inspector,
  integration,
  setup,
  T0,
  until,
} from './instrument-fixture';

/**
 * The capture station's instrument, observe only: driver events become readings under the
 * instrument principal, and an inspector confirms one as a result. The driver is the in-process
 * fake speaking the real protocol; the Python driver is tested in `instrument-driver.test.ts`.
 */
describe('the measuring instrument', () => {
  test('a driver event becomes a reading an inspector confirms once, with the unit that took it', async () => {
    const { app, sor, readings, record } = await setup();
    const fake = createFakeDriver({
      contract: instrumentContract,
      state: { stable: true, unit: 'mm', value: 0 },
      devices: [{ serial: 'AD-4410', firmware: '1.2' }],
    });
    const { supervisor, errors, close } = connectInstrument(app, fake.start, { now: () => T0 });
    try {
      await supervisor.ready();
      fake.emit('measurement.taken', { value: 220.03, unit: 'mm' });
      await until(async () => (await readings()).length === 1);
      const [reading] = await readings();
      expect(reading).toMatchObject({
        value: 220.03,
        unit: 'mm',
        observedAt: T0,
        device: { driver: 'fake-measuring-instrument', serial: 'AD-4410', firmware: '1.2' },
      });

      const result = (await record(reading)).result;
      expect(result).toMatchObject({
        value: 220.03,
        evaluation: 'accepted',
        occurredAt: T0,
        instrument: { readingId: reading.id, serial: 'AD-4410' },
        capture: { actor: 'human', input: 'instrument' },
      });
      expect(await readings()).toEqual([]);
      await expect(record(reading, { characteristicId: 'C20' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      await createEffectDispatcher({
        application: app,
        port: sor,
        context: integration,
        completeOperation: 'inspection.effect.complete',
        now: () => T0,
      }).runOnce();
      expect([...sor.documents.values()][0]!.payload).toMatchObject({
        value: 220.03,
        instrument: { serial: 'AD-4410' },
      });
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test('only the instrument principal reports readings, and it can do nothing else', async () => {
    const { app, command, readings, ingest } = await setup();
    const input = { session: 's', seq: 0, value: 1, unit: 'mm', observedAt: T0, device };
    await expect(command('inspection.instrument.ingest', input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      command('inspection.instrument.ingest', input, {
        ...integration,
        grant: { operations: ['inspection.instrument.ingest'] },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const reading = (await ingest(220.03)).result;
    await expect(
      command(
        'inspection.result.record',
        { lotId: '4000001', characteristicId: 'C10', value: 220.03, occurredAt: T0 },
        { ...as('instrument'), grant: { operations: ['inspection.result.record'] } },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await readings(as('vic'))).toEqual([]);
    expect(await readings(as('stranger'))).toEqual([]);
    expect((await readings()).map((item) => item.id)).toEqual([reading.id]);
    const visible = (await app.events(0, inspector)).events.map((event) => event.resource);
    expect(visible).toContain(`instrument:${reading.id}`);
    expect(
      (await app.events(0, as('vic'))).events.some((event) =>
        event.resource.startsWith('instrument:'),
      ),
    ).toBe(false);
  });

  test('a confirmation must name the reading on screen, in the characteristic unit, while fresh', async () => {
    const { record, ingest, advance, command } = await setup();
    const reading = (await ingest(220.03)).result;
    await expect(record({ ...reading, value: 220.04 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { field: 'value' },
    });
    await expect(record({ ...reading, observedAt: T0 - 1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { field: 'occurredAt' },
    });
    await expect(record({ ...reading, id: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      command('inspection.result.record', {
        lotId: '4000001',
        characteristicId: 'C40',
        code: 'OK',
        occurredAt: reading.observedAt,
        instrumentReading: reading.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'instrumentReading' } });
    const grams = (await ingest(12.5, 'g')).result;
    await expect(record(grams)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { field: 'instrumentReading' },
    });
    advance(10 * 60_000 + 1);
    await expect(record(reading)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('a replayed event records once, and old readings are dropped', async () => {
    const { ingest, readings, record, advance } = await setup();
    const first = (await ingest(220.01)).result;
    expect((await ingest(220.01, 'mm', 0)).result.id).toBe(first.id);
    expect(await readings()).toHaveLength(1);
    for (let index = 0; index < INSTRUMENT_READING_LIMIT; index++) {
      advance(1);
      await ingest(220 + index / 100);
    }
    expect(await readings()).toHaveLength(5);
    // The oldest reading was dropped, so it can no longer be confirmed.
    await expect(record(first)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('state saved before readings existed is upgraded with an empty set', () => {
    const application = createQualityInspectionApplication();
    const { quality } = application.createState('owner');
    const { instrumentReadings: _readings, instrumentPrincipalId: _principal, ...older } = quality;
    expect(application.upgradeState!({ quality: older } as unknown, 'owner').quality).toEqual(
      quality,
    );
  });
});
