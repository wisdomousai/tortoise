import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openEmbeddedInstance } from '@agent-native/host';
import { createCli } from '@agent-native/host/cli';
import { createNotesApplication } from '@agent-native/sample-notes/application';
import { createNotesOperationsApplication } from '../application';
import fixture from './fixtures/workspace-v1.json';

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
type Stored = { notes: { notes: Record<string, Record<string, unknown>> } };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'sample-notes-operations-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'workspace');
}

/** The rows an earlier notes release left: no version stamp, and the note text under `body`. */
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
    notes: { notes: {} },
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
    const code = await createCli(createNotesOperationsApplication(), { program: 'notes' })([
      'migrate',
      '--workspace',
      path,
      ...flags,
    ]);
    return { code, result: JSON.parse(output.at(-1)!) };
  } finally {
    console.log = log;
  }
}

async function getNote(definition: Parameters<typeof openEmbeddedInstance>[0], path: string) {
  const instance = await openEmbeddedInstance(definition, { workspacePath: path });
  try {
    const read = await instance.application.queryRaw(
      { operation: 'note.get', input: { id: 'n1' } },
      owner,
    );
    return read.data;
  } finally {
    await instance.close();
  }
}

test('migrate renames body to text, stamps version 2 and refuses the version 1 code', async () => {
  const path = await workspace();
  await seed(path);

  const rehearsal = await migrate(path, '--dry-run');
  expect(rehearsal.result).toMatchObject({
    migrated: false,
    workspaces: [{ workspace: LOCAL_WORKSPACE, slices: { application: { from: 1, to: 2 } } }],
  });
  expect((await stored(path)).state.notes.notes.n1).toHaveProperty('body');

  expect(await migrate(path)).toMatchObject({ code: 0, result: { migrated: true } });
  const after = await stored(path);
  expect(after.state.notes.notes.n1).toEqual({
    id: 'n1',
    title: 'Shift log',
    text: 'Line 2 down',
    author: 'owner',
    updatedAt: 1000,
  });
  expect(after.stateVersions?.application).toEqual({ version: 2, readableFrom: 2 });

  expect(await getNote(createNotesOperationsApplication(), path)).toMatchObject({
    text: 'Line 2 down',
  });
  await expect(getNote(createNotesApplication(), path)).rejects.toThrow('needs code at version 2');
});

test('a workspace the base sample wrote opens at version 2 with its notes unchanged', async () => {
  const path = await workspace();
  const base = await openEmbeddedInstance(
    createNotesApplication({ services: { newId: () => 'n1', now: () => 1_000 } }),
    { workspacePath: path },
  );
  await base.application.invokeRaw(
    { operation: 'note.add', input: { title: 'Shift log', text: 'Line 2 down' } },
    owner,
  );
  await base.close();

  expect(await getNote(createNotesOperationsApplication(), path)).toMatchObject({
    text: 'Line 2 down',
  });
  expect(await migrate(path)).toMatchObject({ code: 0, result: { migrated: true } });
  expect((await stored(path)).state.notes.notes.n1).toMatchObject({ text: 'Line 2 down' });
});
