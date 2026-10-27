import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openEmbeddedInstance } from '@agent-native/host';
import { createCli } from '@agent-native/host/cli';
import { createTestRequestsApplication } from '@agent-native/pattern-base/application';
import { createTestRequestsOperationsApplication } from '../application';
import fixture from './fixtures/workspace-v1.json';

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
type Stored = { testRequests: { requests: Record<string, Record<string, unknown>> } };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-operations-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'workspace');
}

/** The rows an earlier test requests release left: no version stamp, `sampleId` and `tests`. */
async function seed(path: string) {
  await mkdir(path, { recursive: true });
  const storage = new SQLiteStorage<Stored>(join(path, 'workspace.sqlite'), () =>
    structuredClone(fixture),
  );
  try {
    await storage.transact(LOCAL_WORKSPACE, async () => undefined);
  } finally {
    await storage.close();
  }
}

async function stored(path: string) {
  const storage = new SQLiteStorage<Stored>(join(path, 'workspace.sqlite'), () => ({
    testRequests: { requests: {} },
  }));
  try {
    return await storage.read(LOCAL_WORKSPACE, async (snapshot) => structuredClone(snapshot));
  } finally {
    await storage.close();
  }
}

async function migrate(path: string, ...flags: string[]) {
  const output: string[] = [];
  const log = console.log;
  console.log = (line: string) => void output.push(line);
  try {
    const code = await createCli(createTestRequestsOperationsApplication(), {
      program: 'test-requests',
    })(['migrate', '--workspace', path, ...flags]);
    return { code, result: JSON.parse(output.at(-1)!) };
  } finally {
    console.log = log;
  }
}

async function getRequest(definition: Parameters<typeof openEmbeddedInstance>[0], path: string) {
  const instance = await openEmbeddedInstance(definition, { workspacePath: path });
  try {
    const read = await instance.application.queryRaw(
      { operation: 'test-request.get', input: { id: 'r1' } },
      owner,
    );
    return read.data;
  } finally {
    await instance.close();
  }
}

test('migrate renames sampleId and tests, stamps version 2 and refuses the version 1 code', async () => {
  const path = await workspace();
  await seed(path);

  const rehearsal = await migrate(path, '--dry-run');
  expect(rehearsal.result).toMatchObject({
    migrated: false,
    workspaces: [{ workspace: LOCAL_WORKSPACE, slices: { application: { from: 1, to: 2 } } }],
  });
  expect((await stored(path)).state.testRequests.requests.r1).toHaveProperty('sampleId');

  expect(await migrate(path)).toMatchObject({ code: 0, result: { migrated: true } });
  const after = await stored(path);
  expect(after.state.testRequests.requests.r1).toEqual({
    id: 'r1',
    specimen: 'B-1042-03',
    description: 'Weld coupon from line 2, heat lot 7731',
    method: 'ASTM E8 tensile test',
    requester: 'owner',
    updatedAt: 1000,
  });
  expect(after.stateVersions?.application).toEqual({ version: 2, readableFrom: 2 });

  expect(await getRequest(createTestRequestsOperationsApplication(), path)).toMatchObject({
    specimen: 'B-1042-03',
    method: 'ASTM E8 tensile test',
  });
  await expect(getRequest(createTestRequestsApplication(), path)).rejects.toThrow(
    'needs code at version 2',
  );
});

test('a workspace the base pattern wrote opens at version 2 with its requests unchanged', async () => {
  const path = await workspace();
  const base = await openEmbeddedInstance(
    createTestRequestsApplication({ services: { newId: () => 'r1', now: () => 1_000 } }),
    { workspacePath: path },
  );
  await base.application.invokeRaw(
    {
      operation: 'test-request.submit',
      input: { specimen: 'B-1042-03', description: 'Weld coupon', method: 'ASTM E8 tensile test' },
    },
    owner,
  );
  await base.close();

  const written = (await stored(path)).state.testRequests.requests.r1;
  expect(await getRequest(createTestRequestsOperationsApplication(), path)).toMatchObject({
    specimen: 'B-1042-03',
    method: 'ASTM E8 tensile test',
  });
  expect(await migrate(path)).toMatchObject({ code: 0, result: { migrated: true } });
  expect((await stored(path)).state.testRequests.requests.r1).toEqual(written);
});
