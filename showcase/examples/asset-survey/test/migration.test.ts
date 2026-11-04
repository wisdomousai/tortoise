import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import { LOCAL_WORKSPACE, openEmbeddedInstance } from '@tortoise/host';
import type { ExecutionContext } from '@tortoise/runtime';
import { createAssetSurveyApplication } from '../application';
import { nameplatePhoto } from '../connectors/nameplate-photo';

const at = (principalId: string): ExecutionContext => ({
  workspaceId: LOCAL_WORKSPACE,
  principalId,
});
const owner = at('owner');
const rita = at('rita');
const phone = at('device:d1');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const photo = { digest: `sha256:${'a'.repeat(64)}`, size: 10, mediaType: 'image/png' };
const node = (id: string, designation: string, name: string, parentId?: string) => ({
  id,
  ...(parentId ? { parentId } : {}),
  scheme: 'iec81346',
  designation,
  name,
  source: 'manual',
  attributes: {} as Record<string, unknown>,
  retired: false,
  createdBy: 'owner',
  createdAt: 1,
});
const capture = (id: string, assignmentId: string, nodeId: string | undefined, review: string) => ({
  id,
  assignmentId,
  ...(nodeId ? { nodeId } : {}),
  kind: 'nameplate',
  photos: [photo],
  codes: [],
  note: '',
  takenAt: 10,
  deviceId: 'd1',
  receivedAt: 20,
  review,
});
const field = (name: string, value: string, confidence = 0.95) => ({
  name,
  value,
  confidence,
  source: { digest: photo.digest },
});

/**
 * A version 1 hub: one survey round returned and reviewed, one still on phone d1 with a
 * proposal to review, a reading the model refused, and a discarded capture.
 */
function version1() {
  const q1 = node('q1', '=G1-Q1', 'Generator circuit breaker', 'g1');
  q1.attributes.serial = { value: 'S-1', captureId: 'cap-1', edited: false };
  return {
    integrationPrincipalId: 'integration',
    members: { owner: 'manager', rita: 'reviewer' },
    nodes: {
      g1: node('g1', '=G1', 'Generator 1'),
      q1,
      q2: node('q2', '=G1-Q2', 'Station supply breaker', 'g1'),
    },
    documents: {},
    assignments: {
      a0: {
        id: 'a0',
        title: 'Earlier round',
        roots: ['g1'],
        kinds: ['nameplate'],
        status: 'returned',
        deviceId: 'd1',
        createdBy: 'owner',
        createdAt: 0,
        dispatchedAt: 1,
        returnedAt: 3,
      },
      a1: {
        id: 'a1',
        title: 'Nameplates of =G1',
        roots: ['g1'],
        kinds: ['nameplate'],
        status: 'dispatched',
        deviceId: 'd1',
        createdBy: 'owner',
        createdAt: 4,
        dispatchedAt: 5,
      },
    },
    captures: {
      'cap-1': capture('cap-1', 'a0', 'q1', 'reviewed'),
      'cap-2': capture('cap-2', 'a1', 'q2', 'new'),
      'cap-3': capture('cap-3', 'a1', undefined, 'new'),
      'cap-4': { ...capture('cap-4', 'a1', 'q1', 'discarded'), discardReason: 'Blurred' },
    },
    extractions: {
      'cap-1': {
        captureId: 'cap-1',
        effectId: 'e1',
        status: 'accepted',
        model: 'fake',
        fields: [field('serial', 'S-1')],
        accepted: { serial: 'S-1' },
        acceptedBy: 'rita',
      },
      'cap-2': {
        captureId: 'cap-2',
        effectId: 'e2',
        status: 'proposed',
        model: 'fake',
        fields: [field('manufacturer', 'ABB'), field('serial', 'S-2', 0.6)],
      },
      'cap-3': {
        captureId: 'cap-3',
        effectId: 'e3',
        status: 'failed',
        fields: [],
        rejection: { code: 'UNREADABLE', message: 'Too dark' },
      },
    },
    filings: {},
    cursors: { eam: {}, model: {} },
  };
}

async function workspace(stored: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'survey-migration-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const workspacePath = join(directory, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const raw = new SQLiteStorage(join(workspacePath, 'workspace.sqlite'), () => stored);
  await raw.transact(LOCAL_WORKSPACE, async () => {});
  await raw.close();
  const open = async () => {
    const instance = await openEmbeddedInstance(createAssetSurveyApplication(), {
      workspacePath,
    });
    cleanup.push(() => instance.close());
    let key = 0;
    return {
      close: () => instance.close(),
      putBlob: instance.application.putBlob.bind(instance.application),
      query: async <T = any>(operation: string, input: unknown, as = owner) =>
        (await instance.application.queryRaw({ operation, input }, as)).data as T,
      command: async <T = any>(operation: string, input: unknown, as = owner) =>
        (
          await instance.application.invokeRaw(
            { operation, input, idempotencyKey: `k${++key}` },
            as,
          )
        ).result as T,
    };
  };
  const snapshot = async () => {
    const raw = new SQLiteStorage<Record<string, unknown>>(
      join(workspacePath, 'workspace.sqlite'),
      () => ({}),
    );
    try {
      return await raw.read(LOCAL_WORKSPACE, async (stored) => structuredClone(stored));
    } finally {
      await raw.close();
    }
  };
  return { open, snapshot };
}

describe('survey state version 2', () => {
  test('field work stored at version 1 is adopted as survey and extraction assignments', async () => {
    const { open, snapshot } = await workspace(version1());
    const hub = await open();

    const stages = Object.fromEntries(
      (await hub.query('assignment.list', {})).items.map(
        (item: { id: string; kind: string; stage: string; delivery?: string }) => [
          item.id,
          [item.kind, item.stage, item.delivery].filter(Boolean).join(' '),
        ],
      ),
    );
    expect(stages).toEqual({
      a0: 'survey reviewed',
      a1: 'survey working',
      'extraction-cap-1': 'extraction closed accepted',
      'extraction-cap-2': 'extraction done accepted',
      'extraction-cap-3': 'extraction sent rejected',
    });

    // The phone keeps its open survey, with the brief computed from the structure.
    const feed = await hub.query('assignment.feed', {}, phone);
    expect(feed.items.map((item: { id: string }) => item.id)).toEqual(['a1']);
    expect(feed.items[0].brief.nodes.map((n: { designation: string }) => n.designation)).toEqual([
      '=G1',
      '=G1-Q1',
      '=G1-Q2',
    ]);

    // Captures read as before: reviewed, discarded, refused by the model, proposed.
    expect(await hub.query('capture.get', { id: 'cap-1' })).toMatchObject({
      review: 'accepted',
      reviewedBy: 'rita',
      accepted: { serial: 'S-1' },
      reportedBy: 'device:d1',
    });
    expect(await hub.query('capture.get', { id: 'cap-4' })).toMatchObject({
      review: 'discarded',
      reason: 'Blurred',
    });
    expect((await hub.query('capture.get', { id: 'cap-3' })).extraction).toMatchObject({
      status: 'refused',
      rejection: { message: 'Too dark' },
    });
    const proposed = (await hub.query('capture.get', { id: 'cap-2' })).extraction;
    expect(proposed).toMatchObject({ status: 'proposed', reportId: 'extraction-cap-2-1' });
    expect(proposed.fields.map((f: { attention: boolean }) => f.attention)).toEqual([false, true]);

    // The adopted proposal is accepted like a new one, onto its node.
    await hub.command(
      'assignment.extraction.accept',
      { id: proposed.reportId, values: { manufacturer: 'ABB', serial: 'S-2b' } },
      rita,
    );
    expect((await hub.query('structure.node.get', { id: 'q2' })).attributes).toEqual({
      manufacturer: { value: 'ABB', captureId: 'cap-2', edited: false },
      serial: { value: 'S-2b', captureId: 'cap-2', edited: true },
    });

    // The phone, paired again, reports on the adopted survey.
    const taken = await hub.putBlob(nameplatePhoto({ serial: 'S-5' }), 'image/png', phone);
    await hub.command(
      'assignment.survey.report',
      {
        id: 'cap-5',
        assignmentId: 'a1',
        subject: 'q1',
        body: { kind: 'nameplate', photos: [taken], codes: [], note: '', takenAt: 30 },
      },
      phone,
    );
    expect((await hub.query('capture.get', { id: 'cap-5' })).nodeId).toBe('q1');
    await hub.close();

    // The first commit stored the version 2 shape.
    const stored = (await snapshot()) as {
      state: Record<string, any>;
      stateVersions: Record<string, unknown>;
    };
    for (const gone of ['assignments', 'captures', 'extractions'])
      expect(stored.state).not.toHaveProperty(gone);
    expect(stored.state.cursors).toEqual({ eam: {} });
    expect(stored.state.nodes.q1).not.toHaveProperty('source');
    expect(Object.keys(stored.state.assignment.reports).sort()).toEqual([
      'cap-1',
      'cap-2',
      'cap-3',
      'cap-4',
      'cap-5',
      'extraction-cap-1-1',
      'extraction-cap-2-1',
    ]);
    expect(stored.stateVersions).toMatchObject({
      application: { version: 2 },
      'feature:assignment': { version: 1 },
    });
  });

  test('a workspace with proposed nodes or readings in flight is refused unchanged', async () => {
    const stored = version1();
    const proposal = { ...node('q3', '=G1-Q3', 'Earthing switch', 'g1'), source: 'proposed' };
    const waiting = { captureId: 'cap-3', effectId: 'e3', status: 'requested', fields: [] };
    const { open, snapshot } = await workspace({
      ...stored,
      nodes: { ...stored.nodes, q3: proposal },
      extractions: { ...stored.extractions, 'cap-3': waiting },
    });
    // The upgrade runs when the workspace is first read.
    const hub = await open();
    await expect(hub.query('structure.tree', {})).rejects.toThrow(
      'Resolve 1 proposed node(s) and 1 extraction(s) waiting for the model with the previous version first',
    );
    await hub.close();
    const kept = (await snapshot()) as { state: Record<string, unknown> };
    expect(kept.state).toHaveProperty('captures');
    expect(kept.state).not.toHaveProperty('assignment');
  });
});
