import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedAuthority } from '@agent-native/host';
import { createQualityInspectionApplication, demoSystemOfRecord } from '../application';

test('a fresh workspace makes the owner supervisor of the default plant', () => {
  const application = createQualityInspectionApplication();
  const state = application.createState('owner');
  expect(application.upgradeState!(structuredClone(state), 'owner')).toEqual(state);
});

test('the embedded authority syncs and drains the quality system it declares', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-native-embedded-'));
  const authority = await openEmbeddedAuthority(
    createQualityInspectionApplication({ systemOfRecord: demoSystemOfRecord({}) }),
    { workspacePath },
  );
  try {
    expect((await authority.integrations.sync()).map((report) => report.target)).toEqual([
      'quality-system',
    ]);
    const owner = { workspaceId: 'local', principalId: 'owner' };
    const plants = await authority.application.queryRaw(
      { operation: 'inspection.plant.list', input: {} },
      owner,
    );
    expect((plants.data as { items: unknown[] }).items).toEqual([
      { plant: 'P100', role: 'supervisor', members: { owner: 'supervisor' } },
    ]);
    expect(await authority.integrations.drain(0)).toEqual({
      pending: 0,
      targets: [{ target: 'quality-system', pending: 0, held: 0, upstream: 0, deliverable: true }],
    });
  } finally {
    await authority.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
