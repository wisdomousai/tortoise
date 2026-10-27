import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import { llamaServerStandIn } from '@agent-native/model-server/testing';
import { composeLabRequestsLocalModel, type LabRequestsLocalModelOptions } from '../application';

export const owner = { workspaceId: 'local', principalId: 'owner' };
export const viewer = { workspaceId: 'local', principalId: 'viewer' };

/** A loopback port no listener holds, for the stand-in the site policy binds. */
function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port;
}

/**
 * A serving host with a viewer member, sequential IDs, a fast trigger loop and the model server
 * on the llama-server stand-in, whose answers come from `responder.ts`. It returns once the
 * server is ready or refused.
 */
export async function startLab(
  options: Pick<LabRequestsLocalModelOptions, 'model' | 'evaluation'> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'sample-lab-requests-local-model-'));
  const port = freePort();
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'best-effort' },
      destinations: { 'local-inference': { url: `http://127.0.0.1:${port}` } },
      processes: {
        llm: {
          executable: process.execPath,
          args: [llamaServerStandIn, '--host', '127.0.0.1', '--port', String(port)],
          env: { FIXTURE_RESPONDER: resolve(import.meta.dir, '../responder.ts') },
        },
      },
    }),
  );
  let next = 0;
  const { application, models } = composeLabRequestsLocalModel({
    ...options,
    members: { viewer: 'viewer' },
    services: { newId: () => `r${++next}` },
    automationIntervalMs: 10,
    pollMs: 25,
  });
  const workspace = join(directory, 'workspace');
  const host = await startHost(application, {
    workspacePath: workspace,
    integration: false,
    pollMs: 1,
    settings: { 'site-policy': policy },
  });
  for (let tries = 0; tries < 400; tries++) {
    if (!['measuring', 'starting', 'stopped'].includes(models.status().state)) break;
    await Bun.sleep(25);
  }
  /** The audit log's records of one kind, oldest first. */
  const audit = async (kind: string) => {
    const files = (await readdir(join(workspace, 'audit'))).filter((file) =>
      file.endsWith('.jsonl'),
    );
    const lines = (
      await Promise.all(
        files.sort().map((file) => readFile(join(workspace, 'audit', file), 'utf8')),
      )
    )
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; data?: Record<string, unknown> });
    return lines.filter((record) => record.kind === kind);
  };
  return {
    host,
    models,
    directory,
    audit,
    async close() {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function until(check: () => Promise<boolean>, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

/** The error code a call was refused with, or undefined when it succeeded. */
export const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );
