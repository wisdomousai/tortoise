import { afterEach, expect, test } from 'bun:test';
import { LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { nameplatePhoto } from '@agent-native/asset-survey/connectors/nameplate-photo';
import { cleanUp, openPhone, owner, startHub, type Rows } from './fixtures';

afterEach(cleanUp);

test('a capture taken offline reaches the hub once, is read, accepted and filed into the EAM', async () => {
  const survey = await startHub();
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const q1 = await survey.node(g1.id, '=G1-Q1', 'Generator circuit breaker');
  await survey.node(g1.id, '=G1-Q2', 'Station supply breaker');
  const assignment = await survey.command<{ id: string }>('assignment.create', {
    title: 'Nameplates of =G1',
    roots: [g1.id],
    kinds: ['nameplate'],
  });

  const field = await openPhone(survey.hub.url, await survey.enrollment('Phone 1'));
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: field.deviceId });

  // The assignment and its structure arrive through the hub's feed.
  await field.sync();
  expect((await field.query<Rows>('field.assignment.list')).items).toEqual([
    {
      id: assignment.id,
      title: 'Nameplates of =G1',
      kinds: ['nameplate'],
      nodes: 3,
      captures: 0,
      returned: false,
    },
  ]);
  const tree = await field.query<Rows>('field.node.list', { assignmentId: assignment.id });
  expect(tree.items.map((node) => [node.designation, node.depth])).toEqual([
    ['=G1', 0],
    ['=G1-Q1', 1],
    ['=G1-Q2', 1],
  ]);
  // A scanned or typed tag finds its node with spaces and case ignored.
  const found = await field.query<Rows>('field.node.list', {
    assignmentId: assignment.id,
    q: '=g1 -q1',
  });
  expect(found.items.map((node) => node.id)).toEqual([q1.id]);

  // In the plant without a network: two captures and the return wait in the outbox.
  field.link.offline = true;
  const base = { assignmentId: assignment.id, kind: 'nameplate', codes: [], note: '' };
  const plate = await field.photo({
    manufacturer: 'ABB',
    serial: '1VYN300101',
    ratedCurrent: '6300 A',
  });
  await field.command('field.capture.record', {
    ...base,
    id: 'cap-q1',
    nodeId: q1.id,
    photos: [plate],
    codes: ['=G1-Q1'],
    takenAt: 1_000,
  });
  await field.command('field.capture.record', {
    ...base,
    id: 'cap-loose',
    photos: [await field.photo({ manufacturer: 'Siemens' })],
    condition: 'fair',
    note: 'Cabinet without a label',
    takenAt: 2_000,
  });
  expect(
    (await field.query<Rows>('field.capture.list', { unplaced: true })).items.map((c) => c.id),
  ).toEqual(['cap-loose']);
  await field.command('field.assignment.return', { id: assignment.id });
  await expect(
    field.command('field.capture.record', {
      ...base,
      id: 'cap-late',
      photos: [plate],
      takenAt: 3_000,
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await field.deliver()).toMatchObject({ retried: 3 });
  expect(await field.query('field.hub.status')).toMatchObject({ pending: 3, accepted: 0 });

  // Back in range: the photos go up before the records, and the return after the captures.
  field.link.offline = false;
  expect(await field.deliver()).toMatchObject({ accepted: 3 });
  expect(await field.query('field.hub.status')).toMatchObject({
    pending: 0,
    accepted: 3,
    rejected: 0,
  });
  expect((await field.query<Rows>('field.capture.list')).items.map((c) => [c.id, c.sync])).toEqual([
    ['cap-loose', 'accepted'],
    ['cap-q1', 'accepted'],
  ]);
  const ingested = await survey.query<Rows>('capture.list', {});
  expect(ingested.items.map((c) => [c.id, c.nodeId, c.deviceId])).toEqual(
    expect.arrayContaining([
      ['cap-q1', q1.id, field.deviceId],
      ['cap-loose', undefined, field.deviceId],
    ]),
  );
  expect((await survey.hub.application.readBlob(plate.digest, owner))?.data).toEqual(
    nameplatePhoto({ manufacturer: 'ABB', serial: '1VYN300101', ratedCurrent: '6300 A' }),
  );
  expect((await survey.query<Rows>('assignment.list')).items[0]!.stage).toBe('returned');

  // Delivering again changes nothing at the hub.
  await field.deliver();
  expect((await survey.query<Rows>('capture.list', {})).items).toHaveLength(2);

  // The hub's next feed closes the assignment on the phone as well.
  await field.sync();
  expect((await field.query<Rows>('field.assignment.list')).items[0]).toMatchObject({
    returned: true,
    returnSync: 'accepted',
    captures: 2,
  });

  // At the desk: read the nameplate, accept it, match the EAM asset and file.
  await survey.command('extraction.request', { captureId: 'cap-q1' });
  await survey.settle();
  await survey.command('extraction.accept', {
    captureId: 'cap-q1',
    values: { manufacturer: 'ABB', serial: '1VYN300101', ratedCurrent: '6300 A' },
  });
  const match = await survey.query<Rows>('eam.asset.search', { q: '=G1-Q1' });
  await survey.command('filing.file', { nodeId: q1.id, assetId: match.items[0]!.externalId });
  await survey.settle();
  expect(await survey.query('structure.node.get', { id: q1.id })).toMatchObject({
    assetId: 'EAM-1001',
  });
  const asset = survey.eam().assets.get('EAM-1001')!;
  expect(asset.attributes).toMatchObject({ manufacturer: 'ABB', ratedCurrent: '6300 A' });
  expect(asset.evidence).toHaveLength(1);
});

test('the phone shows a capture the hub refused, and keeps only its own work', async () => {
  const survey = await startHub();
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const g2 = await survey.node(undefined, '=G2', 'Generator 2');
  const first = await survey.command<{ id: string }>('assignment.create', {
    title: 'Generator 1',
    roots: [g1.id],
    kinds: ['nameplate'],
  });
  const second = await survey.command<{ id: string }>('assignment.create', {
    title: 'Generator 2',
    roots: [g2.id],
    kinds: ['nameplate'],
  });
  const one = await openPhone(survey.hub.url, await survey.enrollment('Phone 1'));
  const two = await openPhone(survey.hub.url, await survey.enrollment('Phone 2'), 'phone-2');
  await survey.command('assignment.dispatch', { id: first.id, deviceId: one.deviceId });
  await survey.command('assignment.dispatch', { id: second.id, deviceId: two.deviceId });
  await one.sync();
  await two.sync();
  expect((await two.query<Rows>('field.assignment.list')).items.map((a) => a.id)).toEqual([
    second.id,
  ]);

  // A node of another assignment is refused on the phone itself.
  const base = { kind: 'nameplate', codes: [], note: '', takenAt: 1_000 };
  await expect(
    two.command('field.capture.record', {
      ...base,
      id: 'cap-x',
      assignmentId: second.id,
      nodeId: g1.id,
      photos: [await two.photo({ serial: 'X' })],
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

  // The hub already holds a capture with this ID from the other phone, so it refuses this one.
  await one.command('field.capture.record', {
    ...base,
    id: 'cap-1',
    assignmentId: first.id,
    nodeId: g1.id,
    photos: [await one.photo({ serial: 'A' })],
  });
  await one.deliver();
  await two.command('field.capture.record', {
    ...base,
    id: 'cap-1',
    assignmentId: second.id,
    nodeId: g2.id,
    photos: [await two.photo({ serial: 'B' })],
  });
  expect(await two.deliver()).toMatchObject({ rejected: 1 });
  expect((await two.query<Rows>('field.capture.list')).items[0]).toMatchObject({
    id: 'cap-1',
    sync: 'rejected',
    rejection: { code: 'CONFLICT' },
  });
  expect(await two.query('field.hub.status')).toMatchObject({ rejected: 1, pending: 0 });
});

test('a capture waits while the hub serves a changed capture.ingest', async () => {
  const survey = await startHub();
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const assignment = await survey.command<{ id: string }>('assignment.create', {
    title: 'Generator 1',
    roots: [g1.id],
    kinds: ['nameplate'],
  });
  const field = await openPhone(survey.hub.url, await survey.enrollment('Phone 1'));
  // The first call to the hub reads its contract.
  field.link.drifted = true;
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: field.deviceId });
  await field.sync();
  expect((await field.query<Rows>('field.assignment.list')).items).toHaveLength(1);

  await field.command('field.capture.record', {
    id: 'cap-1',
    assignmentId: assignment.id,
    nodeId: g1.id,
    kind: 'nameplate',
    codes: [],
    note: '',
    takenAt: 1_000,
    photos: [await field.photo({ serial: 'A' })],
  });
  expect(await field.deliver()).toMatchObject({ accepted: 0 });
  expect(
    (
      await field.phone.instance.application.pendingEffects(
        { workspaceId: LOCAL_WORKSPACE, principalId: 'integration' },
        { target: 'hub' },
      )
    ).map((effect) => effect.lastFailure),
  ).toEqual(['capture.ingest changed on hub; calls wait until the two applications agree']);
  expect((await survey.query<Rows>('capture.list')).items).toEqual([]);
  expect(await field.query('field.hub.status')).toMatchObject({ pending: 1, accepted: 0 });
});
