import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import type { StateMigrations } from '@agent-native/kernel/migrations';
import { defineApplication } from '../src/application';
import { createCli } from '../src/cli';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openEmbeddedInstance } from '../src/embedded';
import { defineManifest } from '../src/manifest';

const bump = defineCapability({
  id: 'counter.bump',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ value: z.number() })),
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
type Counter = Record<string, number | string>;

/**
 * Version 1 keeps `count`; version 2 renames it to `total` (older code cannot read that);
 * version 3 adds an optional `label` (version 2 still reads it). Each bump reports to a ledger.
 */
function counter(options: {
  migrations?: StateMigrations;
  field: 'count' | 'total';
  contractVersion: string;
}) {
  return defineApplication<{ counter: Counter }>({
    manifest: defineManifest({
      id: 'counter-app',
      title: 'Counter',
      modules: [defineModule({ id: 'counter', capabilities: [bump] })],
    }),
    createState: () => ({ counter: { [options.field]: 0 } }),
    ...(options.migrations ? { migrations: options.migrations } : {}),
    contractVersion: options.contractVersion,
    handlers: [
      {
        capability: bump,
        handle: async (_input, ctx) => {
          const value = Number(ctx.state.counter[options.field]) + 1;
          ctx.state.counter[options.field] = value;
          ctx.change('counter:main');
          ctx.enqueue({
            target: 'ledger',
            type: 'counter.bumped',
            resource: 'counter:main',
            payload: { [options.field]: value },
          });
          return { value };
        },
      },
    ],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
  });
}
const rename = {
  from: 1,
  to: 2,
  up: (state: unknown) => {
    const { counter: { count, ...rest } = {} } = state as { counter?: Counter };
    return { counter: { ...rest, total: count ?? 0 } };
  },
};
const v1 = counter({ field: 'count', contractVersion: '1' });
const v2 = counter({
  field: 'total',
  contractVersion: '2',
  migrations: { version: 2, steps: [rename] },
});
const label = (fail: boolean) => ({
  from: 2,
  to: 3,
  compatible: true,
  up: (state: unknown) => {
    if (fail) throw new Error('label migration failed');
    const { counter } = state as { counter: Counter };
    return { counter: { ...counter, label: 'main' } };
  },
});
const v3 = (fail: boolean) =>
  counter({
    field: 'total',
    contractVersion: '2',
    migrations: { version: 3, steps: [rename, label(fail)] },
  });

async function bumpWith(
  definition: ReturnType<typeof counter>,
  workspacePath: string,
  key: string,
) {
  const instance = await openEmbeddedInstance(definition, { workspacePath });
  try {
    const receipt = await instance.application.invokeRaw(
      { operation: 'counter.bump', input: {}, idempotencyKey: key },
      { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER },
    );
    return (receipt.result as { value: number }).value;
  } finally {
    await instance.close();
  }
}

async function stored(workspacePath: string) {
  const raw = new SQLiteStorage<{ counter: Counter }>(
    join(workspacePath, 'workspace.sqlite'),
    () => ({
      counter: {},
    }),
  );
  try {
    return await raw.read(LOCAL_WORKSPACE, async (snapshot) => structuredClone(snapshot));
  } finally {
    await raw.close();
  }
}

async function run(definition: ReturnType<typeof counter>, args: string[]) {
  const output: string[] = [];
  const log = console.log;
  console.log = (line: string) => void output.push(line);
  try {
    const code = await createCli(definition, { program: 'counter' })(args);
    return { code, result: JSON.parse(output.at(-1)!) };
  } finally {
    console.log = log;
  }
}

test('an upgrade migrates a staged copy, keeps pending effects as recorded and refuses the old code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-migrate-'));
  const workspace = join(directory, 'workspace');
  try {
    expect(await bumpWith(v1, workspace, 'one')).toBe(1);
    const rehearsal = await run(v2, ['migrate', '--workspace', workspace, '--dry-run']);
    expect(rehearsal.result).toMatchObject({
      migrated: false,
      dryRun: true,
      workspaces: [{ workspace: LOCAL_WORKSPACE, slices: { application: { from: 1, to: 2 } } }],
    });
    // A rehearsal leaves the database as it was.
    expect((await stored(workspace)).state.counter).toEqual({ count: 1 });

    const before = await stored(workspace);
    const upgrade = await run(v2, ['migrate', '--workspace', workspace]);
    expect(upgrade).toMatchObject({ code: 0, result: { migrated: true } });
    const after = await stored(workspace);
    expect(after.state.counter).toEqual({ total: 1 });
    expect(after.stateVersions?.application).toEqual({ version: 2, readableFrom: 2 });
    // Clients reset their cached reads; the effect recorded by version 1 is untouched.
    expect(after.authorizationRevision).toBe(before.authorizationRevision + 1);
    const [effect] = Object.values(after.effects);
    expect(effect).toMatchObject({
      status: 'pending',
      contractVersion: '1',
      payload: { count: 1 },
    });
    expect(await readdir(workspace)).toContain('workspace.sqlite.before-migrate');

    expect(await bumpWith(v2, workspace, 'two')).toBe(2);
    const effects = Object.values((await stored(workspace)).effects);
    expect(effects.map((entry) => entry.contractVersion).sort()).toEqual(['1', '2']);
    // Rolling back to version 1 would misread `total`, so storage refuses it.
    await expect(bumpWith(v1, workspace, 'three')).rejects.toThrow('needs code at version 2');
    // Nothing is left to migrate.
    expect((await run(v2, ['migrate', '--workspace', workspace])).result).toMatchObject({
      migrated: false,
      workspaces: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed migration leaves the workspace serving, and a compatible one allows rollback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-migrate-'));
  const workspace = join(directory, 'workspace');
  try {
    expect(await bumpWith(v2, workspace, 'one')).toBe(1);
    const failed = await run(v3(true), ['migrate', '--workspace', workspace]);
    expect(failed.code).not.toBe(0);
    expect(failed.result.error.message).not.toContain('label migration failed');
    expect(await readdir(workspace)).not.toContain('workspace.sqlite.migrating');
    expect((await stored(workspace)).stateVersions?.application?.version).toBe(2);
    expect(await bumpWith(v2, workspace, 'two')).toBe(2);

    // The fixed release migrates; version 2 can still run on its state.
    expect((await run(v3(false), ['migrate', '--workspace', workspace])).code).toBe(0);
    const migrated = await stored(workspace);
    expect(migrated.state.counter).toEqual({ total: 2, label: 'main' });
    expect(migrated.stateVersions?.application).toEqual({ version: 3, readableFrom: 2 });
    expect(await bumpWith(v2, workspace, 'three')).toBe(3);
    expect((await stored(workspace)).stateVersions?.application?.version).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a migration chain with a gap or the wrong end is refused at definition time', () => {
  expect(() =>
    counter({
      field: 'total',
      contractVersion: '2',
      migrations: { version: 3, steps: [rename, { ...label(false), from: 3, to: 4 }] },
    }),
  ).toThrow('must chain');
  expect(() =>
    counter({ field: 'total', contractVersion: '2', migrations: { version: 3, steps: [rename] } }),
  ).toThrow('not at version 3');
});
