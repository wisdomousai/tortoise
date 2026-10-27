import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBlobStore } from '@agent-native/adapters/blob-files';
import { bunSqlDriver } from '@agent-native/adapters/sqlite';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import type { SecretStore } from '@agent-native/kernel/platform';
import { startHost } from '@agent-native/host/host';
import { createMobilePlatform, openMobileInstance } from '@agent-native/mobile';
import { createManagedConfigPlugin } from '@agent-native/managed-config/managed-config';
import { createAssetSurveyApplication } from '@agent-native/asset-survey/application';
import { nameplatePhoto } from '@agent-native/asset-survey/connectors/nameplate-photo';
import type { FakeEam } from '@agent-native/asset-survey/connectors/fake-eam';
import { createFieldApplication } from '../field-application';

const cleanups: (() => Promise<void> | void)[] = [];
/** Close what the last test opened, newest first; each test file runs it after each test. */
export async function cleanUp() {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

export const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
export type Rows<T = Record<string, any>> = { items: T[] };

/** The hub on loopback, as the desktop runs it, with the outbox and feed passes driven here. */
export async function startHub() {
  const directory = await mkdtemp(join(tmpdir(), 'survey-hub-'));
  let eam!: FakeEam;
  const hub = await startHost(
    createAssetSurveyApplication({ onConnect: (ports) => (eam = ports.eam) }),
    {
      workspacePath: directory,
      integration: false,
    },
  );
  cleanups.push(async () => {
    await hub.close();
    await rm(directory, { recursive: true, force: true });
  });
  let key = 0;
  const command = async <T = Record<string, any>>(operation: string, input: unknown) =>
    (await hub.application.invokeRaw({ operation, input, idempotencyKey: `hub-${++key}` }, owner))
      .result as T;
  const query = async <T = Record<string, any>>(operation: string, input: unknown = {}) =>
    (await hub.application.queryRaw({ operation, input }, owner)).data as T;
  const node = (parentId: string | undefined, designation: string, name: string) =>
    command<{ id: string }>('structure.node.create', {
      ...(parentId ? { parentId } : {}),
      scheme: 'iec81346',
      designation,
      name,
    });
  /** One outbox pass per target and one feed pass: what the hub's background loops do. */
  const settle = async () => {
    await hub.integrations!.target('model').dispatcher.runOnce();
    await hub.integrations!.target('eam').dispatcher.runOnce();
    await hub.integrations!.sync();
  };
  const enrollment = async (label: string) =>
    (await command<{ code: string }>('link.enrollment.create', { label, kind: 'field-sync' })).code;
  return { hub, command, query, node, settle, enrollment, eam: () => eam };
}

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

/**
 * The field app on the mobile platform with Bun's SQLite and files. Device management hands it
 * the hub's address and an enrollment code, so it pairs on its own once it opens. `link.offline`
 * drops the network as airplane mode would; `link.drifted` makes the hub's contract read as a
 * newer release's, whose `capture.ingest` input changed. `platform` is the device's OS.
 */
export async function openPhone(
  origin: string,
  code: string,
  workspace = 'phone-1',
  platform: 'android' | 'ios' = 'android',
) {
  const link = { offline: false, drifted: false };
  const phoneFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (link.offline) throw new TypeError('Network is unreachable');
    const answer = await fetch(input, init);
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (!link.drifted || path !== '/api/v1/contract') return answer;
    const contract = (await answer.json()) as {
      operations: { id: string; schemaDigest?: string }[];
    };
    for (const operation of contract.operations)
      if (operation.id === 'capture.ingest') operation.schemaDigest = 'sha256:newer';
    return Response.json(contract);
  }) as typeof fetch;
  const sandbox = mkdtempSync(join(tmpdir(), 'survey-phone-'));
  const mobile = createMobilePlatform({
    id: platform,
    openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
    openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    secrets: memorySecrets(),
  });
  const managed = createManagedConfigPlugin(() => ({ 'hub-url': origin, 'enrollment-code': code }));
  const application = createFieldApplication({ fetch: phoneFetch, plugins: [managed] });
  // One workspace per phone: a process holds each workspace name once.
  const phone = await openMobileInstance(application, { platform: mobile, workspace });
  cleanups.push(async () => {
    await phone.close();
    rmSync(sandbox, { recursive: true, force: true });
  });
  let key = 0;
  const command = async <T = Record<string, any>>(operation: string, input: unknown) =>
    (await phone.transport.command<T>(operation, input, { idempotencyKey: `phone-${++key}` }))
      .result;
  const query = async <T = Record<string, any>>(operation: string, input: unknown = {}) =>
    (await phone.transport.query<T>(operation, input)).data;
  const deviceId = await paired(query);
  const deliver = () =>
    phone.instance.integrations
      .target('hub')
      .dispatcher.runOnce(undefined, { ignoreBackoff: true });
  const sync = () => phone.instance.integrations.sync();
  const photo = (lines: Record<string, string>) =>
    phone.transport.blobs!.put(nameplatePhoto(lines), 'image/png');
  return { phone, application, link, deviceId, command, query, deliver, sync, photo };
}

/** Pairing from managed configuration runs in the background after startup. */
async function paired(query: <T>(operation: string) => Promise<T>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { pairing, lastError } = await query<{
      pairing: { deviceId: string } | null;
      lastError?: string;
    }>('hub.pairing.get');
    if (pairing) return pairing.deviceId;
    if (lastError) throw new Error(lastError);
    await Bun.sleep(10);
  }
  throw new Error('The phone did not pair');
}
