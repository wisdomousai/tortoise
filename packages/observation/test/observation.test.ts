import { expect, test } from 'bun:test';
import type { CommandReceipt, Invocation } from '@tortoise/runtime';
import {
  Debouncer,
  clampConfidence,
  createObserver,
  debounceReadings,
  type ObservationBase,
  type Reading,
} from '../src/index';

const reading = (field: string, value: Reading['value'], confidence = 1): Reading => ({
  field,
  value,
  confidence,
  extractor: 'driver',
  device: { driver: 'gauge', driverVersion: '1.0.0', serial: 'SN-1', firmware: '2.3' },
  observedAt: 1,
  frameDigest: 'f',
});
const fields = { width: { stableReads: 2, minConfidence: 0.9, declared: { unit: 'mm' } } };
const fieldOf = (id: string) => fields[id as keyof typeof fields];

test('a reading counts once it agrees across stable reads, with device provenance', () => {
  const debouncer = new Debouncer();
  expect(debounceReadings(debouncer, [reading('width', 12.5)], fieldOf)).toEqual([]);
  const [stable] = debounceReadings(debouncer, [reading('width', 12.5)], fieldOf);
  expect(stable).toMatchObject({
    status: 'observed',
    minConfidence: 0.9,
    declared: { unit: 'mm' },
    device: { serial: 'SN-1', firmware: '2.3' },
  });
  // A different value restarts the count; a field that disappears is forgotten.
  expect(debounceReadings(debouncer, [reading('width', 13)], fieldOf)).toEqual([]);
  expect(debounceReadings(debouncer, [], fieldOf)).toEqual([]);
  expect(debounceReadings(debouncer, [reading('width', 13)], fieldOf)).toEqual([]);
});

test('a stable reading below its threshold is uncertain, and unknown fields are dropped', () => {
  const debouncer = new Debouncer();
  const readings = [reading('width', 12.5, 0.5), reading('ghost', 1)];
  debounceReadings(debouncer, readings, fieldOf);
  expect(debounceReadings(debouncer, readings, fieldOf)).toEqual([
    expect.objectContaining({ field: 'width', status: 'uncertain' }),
  ]);
  expect([clampConfidence(1.4), clampConfidence(-1)]).toEqual([1, 0]);
});

interface Gauge extends ObservationBase {
  readonly device: string;
}

test('the observer resubmits unchanged content once per heartbeat under payload keys', async () => {
  let at = 0;
  let value = 12.5;
  const submitted: Invocation[] = [];
  const debouncer = new Debouncer();
  const observer = createObserver<Gauge>({
    source: 'gauge-1',
    sample: async () => {
      at += 1_000;
      return {
        device: 'gauge-1',
        observedAt: at,
        frameDigest: `f${at}`,
        readings: debounceReadings(
          debouncer,
          [{ ...reading('width', value), observedAt: at }],
          fieldOf,
        ),
      };
    },
    application: {
      async invokeRaw(request) {
        submitted.push(request);
        return { result: {}, revision: submitted.length } as unknown as CommandReceipt;
      },
    },
    context: { workspaceId: 'w', principalId: 'driver:gauge-1' },
    ingestOperation: 'gauge.observation.ingest',
    heartbeatMs: 5_000,
  });
  for (let pass = 0; pass < 4; pass++) await observer.runOnce();
  // Pass 1 (nothing stable) and pass 2 (stable) differ; passes 3 and 4 repeat pass 2's content.
  expect(submitted).toHaveLength(2);
  await observer.runOnce();
  // A new heartbeat window resubmits the same content under a new key (its time differs).
  expect(submitted).toHaveLength(3);
  value = 13;
  await observer.runOnce();
  expect(submitted).toHaveLength(4);
  expect(submitted.map((request) => request.idempotencyKey)).toEqual(
    submitted.map(() => expect.stringMatching(/^observe:gauge-1:[0-9a-f]{32}$/)),
  );
  expect(new Set(submitted.map((request) => request.idempotencyKey)).size).toBe(4);
});

test('stopping during a pass ends the loop without waiting out the interval', async () => {
  let release!: () => void;
  const observer = createObserver<ObservationBase>({
    source: 'slow',
    sample: () =>
      new Promise((resolve) => {
        release = () => resolve({ observedAt: 1, frameDigest: 'f', readings: [] });
      }),
    application: { invokeRaw: async () => ({ result: {} }) as unknown as CommandReceipt },
    context: { workspaceId: 'w', principalId: 'observer' },
    ingestOperation: 'gauge.observation.ingest',
  });
  observer.start(60_000);
  await Bun.sleep(5);
  const stopped = observer.stop();
  release();
  const outcome = await Promise.race([
    stopped.then(() => 'stopped'),
    Bun.sleep(500).then(() => 'waiting'),
  ]);
  expect(outcome).toBe('stopped');
});
