import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineModule } from '@agent-native/contracts';
import { stampBuild } from '@agent-native/kernel/build';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { defineApplication } from '../src/application';
import { startHost } from '../src/host';
import { defineManifest } from '../src/manifest';

const definition = defineApplication<Record<string, never>>({
  manifest: defineManifest({
    id: 'shelf',
    title: 'Shelf',
    modules: [defineModule({ id: 'shelf', capabilities: [] })],
    shelfLifeDays: 30,
  }),
  createState: () => ({}),
  handlers: [],
  authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
});

/** `GET /api/v1/build` with an owner session, or with none. */
async function readBuild(applicationDefinition: typeof definition, authorized = true) {
  const directory = await mkdtemp(join(tmpdir(), 'host-build-'));
  const host = await startHost(applicationDefinition, {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  try {
    const { token } = host.sessions.create(
      { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER },
      60_000,
    );
    const response = await fetch(`${host.url}/api/v1/build`, {
      headers: authorized ? { Authorization: `Bearer ${token}` } : {},
    });
    return { host: host.build, status: response.status, body: await response.json() };
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('a stamped build reports its best-before date, and one past it keeps serving', async () => {
  const builtAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const bestBefore = new Date(Date.parse(builtAt) + 30 * 86_400_000).toISOString().slice(0, 10);
  const facts = { builtAt, shelfLifeDays: 30, bestBefore };
  expect(await readBuild(stampBuild(definition, builtAt))).toEqual({
    host: facts,
    status: 200,
    body: { ...facts, pastBestBefore: true },
  });
});

test('a run from source has no build, and the route needs a session', async () => {
  expect(await readBuild(definition)).toEqual({ host: undefined, status: 200, body: {} });
  expect((await readBuild(definition, false)).status).toBe(403);
});
