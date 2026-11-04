import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@tortoise/contracts';
import { createApplicationRuntime } from '@tortoise/host/application';
import { startHost } from '@tortoise/host/host';
import { createMemoryStorage } from '@tortoise/runtime';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing';
import { requestOperations } from '@tortoise/pattern-base/contracts';
import { createTestRequestsHostPluginApplication } from '../application';
import { activityOperations } from '../plugins/activity/contracts';
import { activityPolicy, createActivityState } from '../plugins/activity/server';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'pattern-host-plugin-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

const application = () =>
  createTestRequestsHostPluginApplication({
    members: { viewer: 'viewer' },
    activityIntervalMs: 10,
  });

type Summary = { cursor: number; operations: { operation: string; count: number }[] };
const summary = async (host: Awaited<ReturnType<typeof startHost>>) =>
  (
    await host.application.queryRaw(
      { operation: activityOperations.summaryGet.id, input: {} },
      localUser,
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
      settings: { 'activity-modules': 'test-requests,stability' },
    }),
  ).rejects.toThrow('activity-modules names unknown modules: stability');
});

test('the loop counts committed test request commands and resumes from its cursor after a restart', async () => {
  const path = await directory();
  const options = { workspacePath: join(path, 'workspace'), integration: false as const };
  let host = await startHost(application(), options);
  // Closes whichever host is open when the test ends.
  cleanup.push(() => host.close());
  const submit = (sample: string) =>
    host.application.invokeRaw(
      {
        operation: requestOperations.requestSubmit.id,
        input: { sample, transformer: 'TR-40517', description: '' },
      },
      localUser,
    );
  const { result } = await submit('OS-24-0417');
  await submit('OS-24-0418');
  await host.application.invokeRaw(
    {
      operation: requestOperations.requestUpdate.id,
      input: { id: (result as { id: string }).id, method: 'IEC 60567 dissolved gas analysis' },
    },
    localUser,
  );
  await until(async () => (await summary(host)).operations.length === 2);
  expect((await summary(host)).operations).toEqual([
    { operation: 'test-request.submit', count: 2 },
    { operation: 'test-request.update', count: 1 },
  ]);
  expect(host.plugins).toMatchObject({ activity: { modules: ['test-requests'] } });
  await host.close();

  host = await startHost(application(), options);
  await submit('OS-24-0502');
  await until(async () => (await summary(host)).operations[0]?.count === 3);
  // The restarted loop counted only the new command.
  expect((await summary(host)).operations).toEqual([
    { operation: 'test-request.submit', count: 3 },
    { operation: 'test-request.update', count: 1 },
  ]);
});

test('the plugin policy decides its own operations only', async () => {
  const path = await directory();
  const host = await startHost(application(), {
    workspacePath: join(path, 'workspace'),
    integration: false,
  });
  cleanup.push(() => host.close());
  // A lab viewer reads test requests through the base policy, but is not an activity reader.
  await host.application.queryRaw(
    { operation: requestOperations.requestList.id, input: {} },
    viewer,
  );
  expect(
    await refused(
      host.application.queryRaw({ operation: activityOperations.summaryGet.id, input: {} }, viewer),
    ),
  ).toBe('FORBIDDEN');
  // Asked about another module's operation, the plugin's port has no policy for it.
  expect(
    activityPolicy.authorize({
      capability: requestOperations.requestSubmit,
      context: localUser,
      state: createActivityState('local-user'),
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
            input: { cursor, counted: [{ operation: 'test-request.submit', count: 2 }] },
          },
          localUser,
        );
      await pass(4);
      await pass(4);
      const read = await driver.query(
        { operation: activityOperations.summaryGet.id, input: {} },
        localUser,
      );
      expect(read.data).toEqual({
        cursor: 4,
        operations: [{ operation: 'test-request.submit', count: 2 }],
        modules: ['test-requests'],
      });
    },
  },
];

test('behavioural scenarios through the direct driver', async () => {
  const definition = application();
  const runtime = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState('local-user')),
    services: { activity: { modules: ['test-requests'] } },
  });
  await runScenarios(scenarios, directDriver(runtime));
});
