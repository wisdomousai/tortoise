import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import { acquireWorkspaceOwnership } from '@agent-native/adapters/ownership';
import { defineApplication } from '../src/application';
import { createCli } from '../src/cli';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openEmbeddedInstance } from '../src/embedded';
import { defineManifest } from '../src/manifest';

const count = jsonSchema(z.strictObject({ count: z.number() }));
const bump = defineCapability({
  id: 'counter.bump',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: count,
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
const definition = defineApplication<{ counter: { count: number } }>({
  manifest: defineManifest({
    id: 'counter-app',
    title: 'Counter',
    modules: [defineModule({ id: 'counter', capabilities: [bump] })],
  }),
  createState: () => ({ counter: { count: 0 } }),
  handlers: [
    {
      capability: bump,
      handle: async (_input, ctx) => {
        ctx.state.counter.count += 1;
        ctx.change('counter:main');
        return ctx.state.counter;
      },
    },
  ],
  authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
});

async function bumpOnce(workspacePath: string, key: string) {
  const instance = await openEmbeddedInstance(definition, { workspacePath });
  try {
    const receipt = await instance.application.invokeRaw(
      { operation: 'counter.bump', input: {}, idempotencyKey: key },
      { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER },
    );
    return (receipt.result as { count: number }).count;
  } finally {
    await instance.close();
  }
}

test('backup copies a live workspace, and restore refuses while a host owns it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-backup-'));
  const workspace = join(directory, 'workspace');
  const backup = join(directory, 'backup.sqlite');
  const main = createCli(definition, { program: 'counter' });
  const output: string[] = [];
  const log = console.log;
  console.log = (line: string) => void output.push(line);
  try {
    expect(await bumpOnce(workspace, 'one')).toBe(1);
    expect(await main(['backup', '--workspace', workspace, '--out', backup])).toBe(0);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ schemaVersion: 2, workspaces: 1 });
    expect(await bumpOnce(workspace, 'two')).toBe(2);
    const host = await acquireWorkspaceOwnership(workspace);
    try {
      expect(await main(['restore', '--workspace', workspace, '--from', backup])).not.toBe(0);
    } finally {
      await host.release();
    }
    expect(await main(['restore', '--workspace', workspace, '--from', backup])).toBe(0);
    expect(await bumpOnce(workspace, 'three')).toBe(2);
  } finally {
    console.log = log;
    await rm(directory, { recursive: true, force: true });
  }
});
