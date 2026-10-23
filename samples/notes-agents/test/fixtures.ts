import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import { createNotesAgentsApplication } from '../application';

export const owner = { workspaceId: 'local', principalId: 'owner' };
export const viewer = { workspaceId: 'local', principalId: 'viewer' };

/** A serving host with a viewer member, sequential ids and a fast trigger loop. */
export async function startNotesAgents() {
  const directory = await mkdtemp(join(tmpdir(), 'sample-notes-agents-'));
  let next = 0;
  const host = await startHost(
    createNotesAgentsApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++next}` },
      automationIntervalMs: 10,
    }),
    { workspacePath: join(directory, 'workspace'), integration: false, pollMs: 1 },
  );
  return {
    host,
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
