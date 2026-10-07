import { expect, test } from 'bun:test';
import type { CommandReceipt, Invocation } from '@agent-native/runtime';
import { createAccessibilityExtractor } from '../src/perception/accessibility';
import { createStationObserver, type Observation } from '../src/observer';
import { createCounterModel, createHmi, profile } from './support';

function observerFixture() {
  const hmi = createHmi();
  const model = createCounterModel(hmi);
  const submitted: Invocation[] = [];
  const observer = createStationObserver({
    station: 'line-1',
    profile,
    transport: hmi.transport,
    extractors: [createAccessibilityExtractor(), model.extractor],
    application: {
      async invokeRaw(request) {
        submitted.push(request);
        return { result: {}, revision: submitted.length } as unknown as CommandReceipt;
      },
    },
    context: { workspaceId: 'w', principalId: 'station-bridge:line-1' },
    ingestOperation: 'line.observation.ingest',
    heartbeatMs: 60_000,
  });
  const readings = (index: number) =>
    Object.fromEntries(
      (submitted[index]!.input as Observation).readings.map((reading) => [reading.field, reading]),
    );
  return { hmi, model, observer, submitted, readings };
}

test('readings are submitted only once stable, with provenance', async () => {
  const { observer, readings } = observerFixture();
  await observer.runOnce();
  // count needs two agreeing reads; machine and recipe need one.
  expect(Object.keys(readings(0)).sort()).toEqual(['machine', 'recipe']);
  await observer.runOnce();
  expect(readings(1).count).toMatchObject({
    value: 1200,
    status: 'observed',
    extractor: 'ocr',
    model: { id: 'test-ocr', version: '1' },
    minConfidence: 0.9,
  });
  expect(readings(1).machine).toMatchObject({
    value: 'STOPPED',
    confidence: 1,
    extractor: 'accessibility',
  });
});

test('a changing value restarts stability, and an unsure reading is uncertain, not observed', async () => {
  const { hmi, model, observer, readings } = observerFixture();
  await observer.runOnce();
  hmi.state.count = 1201;
  await observer.runOnce();
  expect(readings(1).count).toBeUndefined();
  model.control.confidence = 0.6;
  await observer.runOnce();
  expect(readings(2).count).toMatchObject({ value: 1201, status: 'uncertain', confidence: 0.6 });
});

test('an unchanged screen is one submission per heartbeat window; a change is a new one', async () => {
  const { hmi, observer, submitted } = observerFixture();
  await observer.runOnce();
  await observer.runOnce();
  await observer.runOnce();
  const keys = submitted.map((request) => request.idempotencyKey);
  // Second pass adds the now-stable count; the third is identical to the second.
  expect(keys[2]).toBe(keys[1]!);
  expect(keys[1]).not.toBe(keys[0]!);
  hmi.state.machine = 'RUNNING';
  await observer.runOnce();
  expect(submitted.at(-1)!.idempotencyKey).not.toBe(keys[2]!);
  expect(keys[0]).toStartWith('observe:line-1:');
});

test('an unknown screen reports no readings and forgets stability', async () => {
  const { hmi, observer, submitted, readings } = observerFixture();
  await observer.runOnce();
  hmi.state.screen = 'popup';
  await observer.runOnce();
  expect(submitted[1]!.input).toMatchObject({ screen: null, readings: [] });
  hmi.state.screen = 'main';
  await observer.runOnce();
  expect(readings(2).count).toBeUndefined();
});
