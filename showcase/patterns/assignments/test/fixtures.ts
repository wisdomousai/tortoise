import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@tortoise/contracts';
import { startHost } from '@tortoise/host/host';
import type { ExecutionContext } from '@tortoise/runtime';
import { createTestRequestsAssignmentsApplication } from '../application';

export const owner = { workspaceId: 'local', principalId: 'owner' };
export const vera = { workspaceId: 'local', principalId: 'vera' };
export const olga = { workspaceId: 'local', principalId: 'olga' };

/** A serving host with Vera as a viewer and sequential IDs. */
export async function startTestRequestsAssignments() {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-assignments-'));
  let next = 0;
  const host = await startHost(
    createTestRequestsAssignmentsApplication({
      members: { vera: 'viewer' },
      services: { newId: () => `id-${++next}` },
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

/** The error code a call was refused with, or undefined when it succeeded. */
export const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );
