import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createQualityInspectionApplication, demoSystemOfRecord } from '../application';

test('a fresh workspace makes the owner supervisor of the default plant', () => {
  const application = createQualityInspectionApplication();
  const state = application.createState('owner');
  expect(application.upgradeState!(structuredClone(state), 'owner')).toEqual(state);
});

test('the embedded instance syncs and drains the quality system it declares', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tortoise-embedded-'));
  const instance = await openEmbeddedInstance(
    createQualityInspectionApplication({ systemOfRecord: demoSystemOfRecord({}) }),
    { workspacePath },
  );
  try {
    expect((await instance.integrations.sync()).map((report) => report.target)).toEqual([
      'quality-system',
    ]);
    const owner = { workspaceId: 'local', principalId: 'owner' };
    const plants = await instance.application.queryRaw(
      { operation: 'inspection.plant.list', input: {} },
      owner,
    );
    expect((plants.data as { items: unknown[] }).items).toEqual([
      { plant: 'P100', role: 'supervisor', members: { owner: 'supervisor' } },
    ]);
    expect(await instance.integrations.drain(0)).toEqual({
      pending: 0,
      targets: [
        { target: 'quality-system', pending: 0, held: 0, acknowledged: 0, deliverable: true },
      ],
    });
  } finally {
    await instance.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
