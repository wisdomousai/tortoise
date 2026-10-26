import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import type { ExecutionContext } from '@agent-native/runtime';
import { createNotesAssignmentsApplication } from '../application';

export const owner = { workspaceId: 'local', principalId: 'owner' };
export const vera = { workspaceId: 'local', principalId: 'vera' };
export const olga = { workspaceId: 'local', principalId: 'olga' };

/** A serving host with Vera as a viewer, sequential IDs and a fast trigger loop. */
export async function startNotesAssignments() {
  const directory = await mkdtemp(join(tmpdir(), 'sample-notes-assignments-'));
  let next = 0;
  const host = await startHost(
    createNotesAssignmentsApplication({
      members: { vera: 'viewer' },
      services: { newId: () => `id-${++next}` },
      automationIntervalMs: 10,
    }),
    { workspacePath: join(directory, 'workspace'), integration: false, pollMs: 1 },
  );
  const { application } = host;
  let keys = 0;
  const run = async (operation: string, input: object, as: ExecutionContext = owner) =>
    (await application.invokeRaw({ operation, input, idempotencyKey: `k${++keys}` }, as))
      .result as Record<string, unknown>;
  const read = async (operation: string, input: object = {}, as: ExecutionContext = owner) =>
    (await application.queryRaw({ operation, input }, as)).data as Record<string, unknown>;
  return {
    host,
    run,
    read,
    async close() {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

/** The error code a call was refused with, or undefined when it succeeded. */
export const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );
