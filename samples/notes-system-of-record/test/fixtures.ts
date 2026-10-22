import { afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { openEmbeddedInstance } from '@agent-native/host';
import { createNotesSystemOfRecordApplication } from '../application';
import { FakePublisher } from '../fake-publisher';

export const owner = { workspaceId: 'local', principalId: 'owner' };
export const viewer = { workspaceId: 'local', principalId: 'viewer' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * An embedded instance with a viewer member and a fake publisher. The site policy binds the
 * publisher destination to it unless `bound` is false.
 */
export async function open({ bound = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sample-notes-sor-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const publisher = new FakePublisher();
  const url = publisher.start();
  cleanup.push(() => publisher.stop());
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      destinations: bound ? { 'publisher-api': { url } } : {},
    }),
  );
  let next = 0;
  const instance = await openEmbeddedInstance(
    createNotesSystemOfRecordApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++next}` },
    }),
    { workspacePath: join(directory, 'workspace'), settings: { 'site-policy': policy } },
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
      .target('publisher')
      .dispatcher.runOnce(new AbortController().signal, { ignoreBackoff: true });
  const note = (title: string, text: string) =>
    command<{ id: string }>('note.add', { title, text });
  return { application, integrations, publisher, query, command, deliver, note };
}

/** The error code a call was refused with, or undefined when it succeeded. */
export const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );
