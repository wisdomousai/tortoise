import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedAuthority } from '@agent-native/host';
import { createLineStationApplication, demoStations } from '../application';

test('upgrade is idempotent for line-station state', () => {
  const application = createLineStationApplication({ stations: [] });
  const state = application.createState('owner');
  expect(application.upgradeState!(structuredClone(state), 'owner')).toEqual(state);
});

test('the demo bridges a station only when its screen is named explicitly', () => {
  expect(demoStations({})).toEqual([]);
  expect(demoStations({ STATION_HMI_URL: 'http://127.0.0.1:1', STATION_SIMULATOR: '1' })).toEqual([
    expect.objectContaining({ station: 'line-1', counters: { kind: 'simulator' } }),
  ]);
});

test('the embedded authority syncs the MES and reports station targets it cannot deliver', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-native-embedded-'));
  const authority = await openEmbeddedAuthority(createLineStationApplication({ stations: [] }), {
    workspacePath,
  });
  try {
    expect((await authority.integrations.sync()).map((report) => report.target)).toEqual(['mes']);
    expect(await authority.integrations.drain(0)).toEqual({
      pending: 0,
      targets: [{ target: 'mes', pending: 0, held: 0, upstream: 0, deliverable: true }],
    });
  } finally {
    await authority.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
