import { afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@tortoise/contracts';
import { openEmbeddedInstance } from '@tortoise/host';
import { createTestRequestsSystemOfRecordApplication } from '../application';
import { FakeLims } from '../fake-lims';

export const owner = { workspaceId: 'local', principalId: 'owner' };
export const viewer = { workspaceId: 'local', principalId: 'viewer' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * An embedded instance with a viewer member and a fake LIMS. The deployment policy binds the LIMS
 * destination to it unless `bound` is false.
 */
export async function open({ bound = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-base-sor-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const lims = new FakeLims();
  const url = lims.start();
  cleanup.push(() => lims.stop());
  const policy = join(directory, 'deployment-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      destinations: bound ? { 'lims-api': { url } } : {},
    }),
  );
  let next = 0;
  const instance = await openEmbeddedInstance(
    createTestRequestsSystemOfRecordApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++next}` },
    }),
    { workspacePath: join(directory, 'workspace'), settings: { 'deployment-policy': policy } },
  );
  cleanup.push(() => instance.close());
  const { application, integrations } = instance;
  let key = 0;
  const query = async <T = Record<string, unknown>>(
    operation: string,
    input: unknown,
    as = owner,
  ) => (await application.queryRaw({ operation, input }, as)).data as T;
  const command = async <T = Record<string, unknown>>(
    operation: string,
    input: unknown,
    as: { workspaceId: string; principalId: string } = owner,
  ) =>
    (await application.invokeRaw({ operation, input, idempotencyKey: `k${++key}` }, as))
      .result as T;
  /** One outbox pass, as the background loop does, without waiting out a backoff. */
  const deliver = () =>
    integrations
      .target('lims')
      .dispatcher.runOnce(new AbortController().signal, { ignoreBackoff: true });
  const submit = (sample: string, description: string, method: string) =>
    command<{ id: string }>('test-request.submit', {
      sample,
      transformer: 'TR-40517',
      description,
      method,
    });
  return { application, integrations, lims, query, command, deliver, submit };
}

/** The error code a call was refused with, or undefined when it succeeded. */
export const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );
