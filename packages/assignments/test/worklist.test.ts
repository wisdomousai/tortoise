import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createHttpHandler } from '@agent-native/adapters/http';
import { Sessions } from '@agent-native/adapters/http/sessions';
import { definePeerSurface } from '@agent-native/contracts';
import { createApplicationRuntime, defineApplication, defineManifest } from '@agent-native/kernel';
import type { PeerClient } from '@agent-native/integration';
import {
  createMemoryBlobStore,
  createMemoryStorage,
  definePolicy,
  type ExecutionContext,
} from '@agent-native/runtime';
import {
  defineAssignmentKind,
  defineAssignments,
  defineWorklist,
  type AnyAssignmentKind,
  type Assignments,
} from '../src';
import {
  connectWorklist,
  createWorklistSlice,
  worklistHandlers,
  worklistRules,
  type WorklistSlice,
} from '../src/server';
import { createFixture, planner, WORKSPACE } from './application';
import { assignments, issuerSurface, review, survey } from './fixture';

const INTEGRATION = 'integration';
const tess: ExecutionContext = { workspaceId: 'tablet', principalId: 'tess' };
type Tablet = { owner: string; worklist: WorklistSlice };
type Row = Record<string, unknown>;

const destination = {
  id: 'hub',
  purpose: 'Report field work to the issuer and read what it assigns.',
  dataClasses: ['field-record', 'photo'],
  availability: 'optional',
  offline: 'queue',
} as const;

/** The issuer's fixture served over HTTP in process, and a client that is the paired device. */
function issuer() {
  const fixture = createFixture();
  const origin = 'http://127.0.0.1:4300';
  const sessions = new Sessions();
  const { token } = sessions.create({ workspaceId: WORKSPACE, principalId: 'device:tab-1' });
  const handler = createHttpHandler({
    application: fixture.application,
    sessions,
    origin: () => origin,
  });
  const client: PeerClient = {
    fetch: (path, init = {}) =>
      handler(
        new Request(new URL(String(path), origin), {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            authorization: `Bearer ${token}`,
            host: '127.0.0.1:4300',
          },
        }),
      ),
  };
  return { ...fixture, client };
}

/** The tablet: one owner and the worklist of the device lane, connected to `client`. */
function tablet<K extends AnyAssignmentKind>(
  client: PeerClient,
  surface = issuerSurface,
  of: Assignments<K> = assignments as never,
) {
  const worklist = defineWorklist({
    namespace: 'field',
    target: 'hub',
    assignments: of,
    issuer: surface,
    lane: 'device',
    destination,
  });
  const owner = (_id: string, state: Tablet, context: { principalId: string }) =>
    context.principalId === state.owner;
  let next = 0;
  const definition = defineApplication<Tablet>({
    manifest: defineManifest({
      id: 'tablet',
      title: 'Tablet',
      modules: [worklist.module],
      components: [worklist.target.component],
    }),
    createState: () => ({ owner: 'tess', worklist: createWorklistSlice() }),
    handlers: worklistHandlers<Tablet, unknown, (typeof worklist.kinds)[number]>(worklist, {
      slice: (state) => state.worklist,
      newId: () => `tab-r${++next}`,
      now: () => 2_000,
    }),
    authorization: definePolicy<Tablet>({
      integrations: [
        {
          is: (_state, principalId) => principalId === INTEGRATION,
          operations: worklist.target.integrationOperations,
        },
      ],
      caller: { allow: (state, context) => context.principalId === state.owner },
      operations: worklistRules(worklist),
      events: { 'field-assignment': owner, 'field-report': owner, sync: owner },
    }),
  });
  const blobs = createMemoryBlobStore();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(() => definition.createState('tablet')),
    blobStore: () => blobs,
    now: () => 2_000,
  });
  const integration = connectWorklist(worklist, {
    application,
    workspaceId: 'tablet',
    principalId: INTEGRATION,
    client: () => client,
  });
  const run = async (operation: string, input: object) =>
    (await application.invokeRaw({ operation, input }, tess)).result as Row;
  const read = async (operation: string, input: object = {}) =>
    (await application.queryRaw({ operation, input }, tess)).data as Row;
  const photo = () => application.putBlob(new Uint8Array([0xff, 0xd8, 1, 2]), 'image/jpeg', tess);
  return { application, integration, run, read, photo };
}

const send = (fixture: ReturnType<typeof issuer>, title: string) =>
  fixture.application.invokeRaw(
    {
      operation: 'assignment.field-survey.create',
      input: { title, scope: { roots: ['n1'] }, assignee: { type: 'device', id: 'tab-1' } },
    },
    planner,
  );
const atIssuer = async (fixture: ReturnType<typeof issuer>, operation: string, input: object) =>
  (await fixture.application.queryRaw({ operation, input }, planner)).data as Row;

describe('worklist', () => {
  test('the tablet takes a survey, reports with a photo and marks it done at the issuer', async () => {
    const hub = issuer();
    const { integration, run, read, photo } = tablet(hub.client);
    await send(hub, 'Hall 2');
    await integration.inbound.runOnce();
    expect((await read('field.assignment.list')).items).toEqual([
      {
        id: 'a1',
        kind: 'field-survey',
        title: 'Hall 2',
        brief: { nodes: [{ id: 'n1', designation: '=A1' }] },
        sentAt: 1_000,
        open: true,
        done: false,
        reports: 0,
      },
    ]);

    const ref = await photo();
    const report = await run('field.field-survey.report', {
      assignmentId: 'a1',
      subject: 'n1',
      body: { photos: [ref], condition: 'good' },
    });
    expect(report).toMatchObject({ id: 'tab-r1', sync: 'pending' });
    expect(await run('field.assignment.complete', { id: 'a1' })).toMatchObject({
      open: false,
      done: true,
      doneSync: 'pending',
      reports: 1,
    });
    await expect(
      run('field.field-survey.report', { assignmentId: 'a1', body: { photos: [] } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await integration.dispatcher.runOnce()).toMatchObject({ accepted: 2 });
    expect(await atIssuer(hub, 'assignment.get', { id: 'a1' })).toMatchObject({
      status: 'done',
      doneBy: 'device:tab-1',
      reports: 1,
    });
    expect(await atIssuer(hub, 'assignment.report.get', { id: 'tab-r1' })).toMatchObject({
      reportedBy: 'device:tab-1',
      subject: 'n1',
      body: { photos: [{ digest: ref.digest }], condition: 'good' },
    });

    await integration.inbound.runOnce();
    expect(await read('field.assignment.get', { id: 'a1' })).toMatchObject({
      open: false,
      done: true,
      doneSync: 'accepted',
    });
    expect(await read('field.hub.status')).toMatchObject({
      pending: 0,
      accepted: 2,
      rejected: 0,
    });
  });

  test('a report about a node the survey does not cover arrives unplaced, and a retry is harmless', async () => {
    const hub = issuer();
    const { integration, run, photo } = tablet(hub.client);
    await send(hub, 'Hall 2');
    await integration.inbound.runOnce();
    const ref = await photo();
    const body = { photos: [ref], condition: 'fair' };
    await run('field.field-survey.report', { assignmentId: 'a1', subject: 'n7', body });
    expect(await integration.dispatcher.runOnce()).toMatchObject({ accepted: 1 });
    const stored = await atIssuer(hub, 'assignment.report.get', { id: 'tab-r1' });
    expect(stored).toMatchObject({ reportedBy: 'device:tab-1', review: 'new' });
    expect(stored.subject).toBeUndefined();

    // A person places it; the device's retried delivery is still the same report.
    await hub.application.invokeRaw(
      { operation: 'assignment.report.place', input: { id: 'tab-r1', subject: 'n1' } },
      planner,
    );
    const device = { workspaceId: WORKSPACE, principalId: 'device:tab-1' };
    const retried = await hub.application.invokeRaw(
      {
        operation: 'assignment.field-survey.report',
        input: { id: 'tab-r1', assignmentId: 'a1', subject: 'n7', body },
      },
      device,
    );
    expect(retried.result).toMatchObject({ id: 'tab-r1', subject: 'n1' });
  });

  test('work the issuer withdrew is refused there, and a refused done mark reopens it here', async () => {
    const hub = issuer();
    const { integration, run, read } = tablet(hub.client);
    await send(hub, 'Hall 2');
    await integration.inbound.runOnce();
    await hub.application.invokeRaw(
      { operation: 'assignment.withdraw', input: { id: 'a1' } },
      planner,
    );
    await run('field.field-survey.report', { assignmentId: 'a1', body: { photos: [] } });
    await run('field.assignment.complete', { id: 'a1' });
    expect(await integration.dispatcher.runOnce()).toMatchObject({ rejected: 2 });
    expect((await read('field.report.list')).items).toMatchObject([
      { id: 'tab-r1', sync: 'rejected', rejection: { code: 'CONFLICT' } },
    ]);
    expect(await read('field.assignment.get', { id: 'a1' })).toMatchObject({
      open: true,
      done: false,
      doneSync: 'rejected',
      rejection: { code: 'CONFLICT' },
    });

    await integration.inbound.runOnce();
    expect(await read('field.assignment.get', { id: 'a1' })).toMatchObject({ open: false });
    await expect(
      run('field.field-survey.report', { assignmentId: 'a1', body: { photos: [] } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(run('field.assignment.complete', { id: 'a1' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  test('a report command that changed at the issuer holds the delivery until the two agree', async () => {
    const hub = issuer();
    // The tablet was built against a survey whose condition had two values.
    const older = defineAssignments({
      kinds: [
        review,
        defineAssignmentKind({
          ...survey,
          report: z.strictObject({
            photos: survey.report.shape.photos,
            condition: z.enum(['good', 'poor']).optional(),
          }),
        }),
      ],
    });
    const surface = definePeerSurface({
      application: 'assignments-fixture',
      commands: older.lanes.device.commands,
      queries: older.lanes.device.queries,
    });
    const { integration, run, read } = tablet(hub.client, surface, older);
    await send(hub, 'Hall 2');
    await integration.inbound.runOnce();
    await run('field.field-survey.report', { assignmentId: 'a1', body: { photos: [] } });
    expect(await integration.dispatcher.runOnce()).toMatchObject({ accepted: 0, rejected: 0 });
    expect((await read('field.report.list')).items).toMatchObject([{ sync: 'pending' }]);
    expect(await atIssuer(hub, 'assignment.get', { id: 'a1' })).toMatchObject({ reports: 0 });
  });
});
