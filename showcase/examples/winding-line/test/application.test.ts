import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@agent-native/host';
import { createWindingLineApplication, demoAutomationStation, demoStations } from '../application';

test('upgrade is idempotent for winding-line state', () => {
  const application = createWindingLineApplication({ stations: [] });
  const state = application.createState('owner');
  expect(application.upgradeState!(structuredClone(state), 'owner')).toEqual(state);
});

test('the demo bridges a station only when its screen is named explicitly', () => {
  expect(demoStations({})).toEqual([]);
  expect(demoStations({ STATION_HMI_URL: 'http://127.0.0.1:1', STATION_SIMULATOR: '1' })).toEqual([
    expect.objectContaining({ station: 'winder-1', counters: { kind: 'simulator' } }),
  ]);
});

test('the demo reaches a station through its automation driver only when asked', () => {
  expect(demoAutomationStation({})).toBeUndefined();
  const env = { STATION_ROUTE: 'automation', STATION_HMI_URL: 'http://127.0.0.1:1' };
  expect(demoAutomationStation(env)).toMatchObject({ station: 'winder-1' });
  // The station's screen is not bridged as well.
  expect(demoStations(env)).toEqual([]);
});

test('the embedded instance syncs the MES and reports station targets it cannot deliver', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-native-embedded-'));
  const instance = await openEmbeddedInstance(createWindingLineApplication({ stations: [] }), {
    workspacePath,
  });
  try {
    expect((await instance.integrations.sync()).map((report) => report.target)).toEqual(['mes']);
    expect(await instance.integrations.drain(0)).toEqual({
      pending: 0,
      targets: [{ target: 'mes', pending: 0, held: 0, upstream: 0, deliverable: true }],
    });
  } finally {
    await instance.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
