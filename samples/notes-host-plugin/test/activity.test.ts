import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { createApplicationRuntime } from '@agent-native/host/application';
import { startHost } from '@agent-native/host/host';
import { createMemoryStorage } from '@agent-native/runtime';
import { directDriver, runScenarios, type BehavioralScenario } from '@agent-native/testing';
import { noteOperations } from '@agent-native/sample-notes/contracts';
import { createNotesHostPluginApplication } from '../application';
import { activityOperations } from '../plugins/activity/contracts';
import { activityPolicy, createActivityState } from '../plugins/activity/server';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'sample-notes-host-plugin-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

const application = () =>
  createNotesHostPluginApplication({ members: { viewer: 'viewer' }, activityIntervalMs: 10 });

type Summary = { cursor: number; operations: { operation: string; count: number }[] };
const summary = async (host: Awaited<ReturnType<typeof startHost>>) =>
  (
    await host.application.queryRaw(
      { operation: activityOperations.summaryGet.id, input: {} },
      owner,
    )
  ).data as Summary;

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );

test('a module in the setting that the application does not compose refuses startup', async () => {
  const path = await directory();
  await expect(
    startHost(application(), {
      workspacePath: join(path, 'workspace'),
      integration: false,
      settings: { 'activity-modules': 'notes,tasks' },
    }),
  ).rejects.toThrow('activity-modules names unknown modules: tasks');
});

test('the loop counts committed note commands and resumes from its cursor after a restart', async () => {
  const path = await directory();
  const options = { workspacePath: join(path, 'workspace'), integration: false as const };
  let host = await startHost(application(), options);
  // Closes whichever host is open when the test ends.
  cleanup.push(() => host.close());
  const add = (title: string) =>
    host.application.invokeRaw(
      { operation: noteOperations.noteAdd.id, input: { title, text: '' } },
      owner,
    );
  const { result } = await add('Shift log');
  await add('Handover');
  await host.application.invokeRaw(
    {
      operation: noteOperations.noteUpdate.id,
      input: { id: (result as { id: string }).id, text: 'Line 2 down' },
    },
    owner,
  );
  await until(async () => (await summary(host)).operations.length === 2);
  expect((await summary(host)).operations).toEqual([
    { operation: 'note.add', count: 2 },
    { operation: 'note.update', count: 1 },
  ]);
  expect(host.plugins).toMatchObject({ activity: { modules: ['notes'] } });
  await host.close();

  host = await startHost(application(), options);
  await add('Night shift');
  await until(async () => (await summary(host)).operations[0]?.count === 3);
  // The restarted loop counted only the new command.
  expect((await summary(host)).operations).toEqual([
    { operation: 'note.add', count: 3 },
    { operation: 'note.update', count: 1 },
  ]);
});

test('the plugin policy decides its own operations only', async () => {
  const path = await directory();
  const host = await startHost(application(), {
    workspacePath: join(path, 'workspace'),
    integration: false,
  });
  cleanup.push(() => host.close());
  // A notes viewer reads notes through the base policy, but is not an activity reader.
  await host.application.queryRaw({ operation: noteOperations.noteList.id, input: {} }, viewer);
  expect(
    await refused(
      host.application.queryRaw({ operation: activityOperations.summaryGet.id, input: {} }, viewer),
    ),
  ).toBe('FORBIDDEN');
  // Asked about another module's operation, the plugin's port has no policy for it.
  expect(
    activityPolicy.authorize({
      capability: noteOperations.noteAdd,
      context: owner,
      state: createActivityState('owner'),
    } as Parameters<typeof activityPolicy.authorize>[0]),
  ).toEqual({ allowed: false, reason: 'NO_POLICY' });
});

const scenarios: BehavioralScenario[] = [
  {
    name: 'a recorded pass adds to the counts, and a pass at an old cursor adds nothing',
    async run(driver) {
      const pass = (cursor: number) =>
        driver.command(
          {
            operation: activityOperations.passRecord.id,
            input: { cursor, counted: [{ operation: 'note.add', count: 2 }] },
          },
          owner,
        );
      await pass(4);
      await pass(4);
      const read = await driver.query(
        { operation: activityOperations.summaryGet.id, input: {} },
        owner,
      );
      expect(read.data).toEqual({
        cursor: 4,
        operations: [{ operation: 'note.add', count: 2 }],
        modules: ['notes'],
      });
    },
  },
];

test('behavioural scenarios through the direct driver', async () => {
  const definition = application();
  const runtime = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState('owner')),
    services: { activity: { modules: ['notes'] } },
  });
  await runScenarios(scenarios, directDriver(runtime));
});
