import { afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance, type EmbeddedInstance } from '@tortoise/host';
import { createPartsDeskApplication } from '../application';
import { seedTrialRecords } from '../trial-records';

export const localUser = { workspaceId: 'local', principalId: 'local-user' };
export const viewer = { workspaceId: 'local', principalId: 'viewer' };
export const supervisor = { workspaceId: 'local', principalId: 'mara' };
export const stranger = { workspaceId: 'local', principalId: 'stranger' };

/**
 * A Parts Desk workspace for one test: the local user at the desk, a viewer, mara as a supervisor,
 * sequential IDs and a fixed clock.
 */
export function testWorkspaces(name: string) {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });
  return async function open(options: { trialRecords?: boolean } = {}) {
    const workspacePath = await mkdtemp(join(tmpdir(), `parts-desk-${name}-`));
    let ids = 0;
    const instance = await openEmbeddedInstance(
      createPartsDeskApplication({
        members: { viewer: 'viewer', mara: 'supervisor' },
        services: { newId: () => `id-${++ids}`, now: () => 1_000 },
      }),
      { workspacePath },
    );
    cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
    cleanup.push(() => instance.close());
    if (options.trialRecords) await seedTrialRecords(instance.application);
    return instance.application;
  };
}

type Application = EmbeddedInstance['application'];

/** The IDs of the trial utilities by account: U1042 runs TR-40417, U2117 runs TR-40471. */
export async function utilityIds(app: Application): Promise<Record<string, string>> {
  const { data } = await app.queryRaw({ operation: 'customer.list', input: {} }, localUser);
  return Object.fromEntries(
    (data as { items: { id: string; account: string }[] }).items.map((c) => [c.account, c.id]),
  );
}

/**
 * The receipt of a draft quote by the local user for TR-40417, a PTX-40 at Stadtwerke Nordhafen, in a workspace
 * with the trial records: one HV bushing at 14,800.00 and two tank cover gaskets at 690.00, so
 * 1,618,000 cents before a discount.
 */
export async function draftQuote(app: Application, key = 'draft') {
  const ids = await utilityIds(app);
  const receipt = await app.invokeRaw(
    {
      operation: 'quote.create',
      input: {
        customerId: ids.U1042!,
        transformerSerial: 'TR-40417',
        lines: [
          { partNumber: 'BSH-145-1250', quantity: 1 },
          { partNumber: 'GSK-TC-40', quantity: 2 },
        ],
      },
      idempotencyKey: key,
    },
    localUser,
  );
  return { ...receipt, result: receipt.result as { id: string; number: string; total: number } };
}
