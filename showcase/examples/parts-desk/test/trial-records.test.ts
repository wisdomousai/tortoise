import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createPartsDeskApplication } from '../application';
import { assemblies, partCategories } from '../contracts/part';
import { seedTrialRecords } from '../trial-records';
import { localUser } from './support';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

type Page = { items: Record<string, unknown>[]; total: number };

/** One launch: open the workspace, seed it as dev.ts does, read every record, close it. */
async function launch(workspacePath: string) {
  const instance = await openEmbeddedInstance(createPartsDeskApplication(), { workspacePath });
  try {
    await seedTrialRecords(instance.application);
    const read = async (operation: string) =>
      (await instance.application.queryRaw({ operation, input: { limit: 100 } }, localUser))
        .data as Page;
    return {
      customers: await read('customer.list'),
      transformers: await read('transformer.list'),
      parts: await read('part.list'),
    };
  } finally {
    await instance.close();
  }
}

test('the trial records cover every category and assembly, and a relaunch adds nothing', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'parts-desk-trial-'));
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  const first = await launch(workspacePath);
  expect(first.customers.total).toBe(3);
  expect(first.transformers.total).toBe(6);
  expect(new Set(first.transformers.items.map((item) => item.model)).size).toBe(3);
  expect(first.parts.total).toBe(24);
  expect(new Set(first.parts.items.map((item) => item.category))).toEqual(new Set(partCategories));
  expect(new Set(first.parts.items.map((item) => item.assembly))).toEqual(new Set(assemblies));
  expect(first.parts.items.some((item) => item.stock === 0)).toBe(true);
  expect(first.parts.items.some((item) => (item.stock as number) > 0)).toBe(true);
  // The second launch replays the stored command results: the same records under the same IDs.
  expect(await launch(workspacePath)).toEqual(first);
});
