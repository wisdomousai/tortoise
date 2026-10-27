import { afterEach, expect, test } from 'bun:test';
import { LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { nameplatePhoto } from '@agent-native/asset-survey/connectors/nameplate-photo';
import { matches, tree, type BriefNode } from '../ui-native/brief';
import { cleanUp, openPhone, owner, startHub, type Rows } from './fixtures';

afterEach(cleanUp);

test('a capture taken offline reaches the hub once, is read, accepted and filed into the EAM', async () => {
  const survey = await startHub();
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const q1 = await survey.node(g1.id, '=G1-Q1', 'Generator circuit breaker');
  await survey.node(g1.id, '=G1-Q2', 'Station supply breaker');
  const field = await openPhone(survey.hub.url, await survey.enrollment('Phone 1'));
  const assignment = await survey.send('Nameplates of =G1', g1.id, field.deviceId);

  // The survey and its structure arrive through the hub's feed.
  await field.sync();
  const [held] = (await field.query<Rows>('field.assignment.list')).items;
  expect(held).toMatchObject({
    id: assignment.id,
    kind: 'survey',
    title: 'Nameplates of =G1',
    brief: { kinds: ['nameplate'] },
    open: true,
    done: false,
    reports: 0,
  });
  // The phone draws the tree from the brief, and a scanned or typed tag finds its node with
  // spaces and case ignored.
  const nodes = held!.brief.nodes as BriefNode[];
  expect(tree(nodes).map((node) => [node.designation, node.depth])).toEqual([
    ['=G1', 0],
    ['=G1-Q1', 1],
    ['=G1-Q2', 1],
  ]);
  expect(nodes.filter((node) => matches(node, '=g1 -q1')).map((node) => node.id)).toEqual([q1.id]);

  // In the plant without a network: two captures and the done mark wait in the outbox.
  field.link.offline = true;
  const lines = { manufacturer: 'ABB', serial: '1VYN300101', ratedCurrent: '6300 A' };
  const placed = await field.capture(assignment.id, q1.id, lines, { codes: ['=G1-Q1'] });
  const loose = await field.capture(
    assignment.id,
    undefined,
    { manufacturer: 'Siemens' },
    { condition: 'fair', note: 'Cabinet without a label', takenAt: 2_000 },
  );
  expect(
    (await field.query<Rows>('field.report.list')).items
      .filter((report) => report.subject === undefined)
      .map((report) => report.id),
  ).toEqual([loose.id]);
  await field.command('field.assignment.complete', { id: assignment.id });
  await expect(field.capture(assignment.id, q1.id, lines)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(await field.deliver()).toMatchObject({ retried: 3 });
  expect(await field.query('field.hub.status')).toMatchObject({ pending: 3, accepted: 0 });

  // Back in range: the photos go up before the records, and the done mark after the captures.
  field.link.offline = false;
  expect(await field.deliver()).toMatchObject({ accepted: 3 });
  expect(await field.query('field.hub.status')).toMatchObject({
    pending: 0,
    accepted: 3,
    rejected: 0,
  });
  expect((await field.query<Rows>('field.report.list')).items.map((report) => report.sync)).toEqual(
    ['accepted', 'accepted'],
  );
  const reported = await survey.query<Rows>('capture.list', {});
  expect(reported.items.map((c) => [c.id, c.nodeId, c.reportedBy])).toEqual(
    expect.arrayContaining([
      [placed.id, q1.id, `device:${field.deviceId}`],
      [loose.id, undefined, `device:${field.deviceId}`],
    ]),
  );
  const plate = (await survey.query('capture.get', { id: placed.id })).photos[0];
  expect((await survey.hub.application.readBlob(plate.digest, owner))?.data).toEqual(
    nameplatePhoto(lines),
  );
  expect((await survey.query<Rows>('assignment.list', { kind: 'survey' })).items[0]!.stage).toBe(
    'done',
  );

  // Delivering again changes nothing at the hub.
  await field.deliver();
  expect((await survey.query<Rows>('capture.list', {})).items).toHaveLength(2);

  // The hub's next feed no longer lists the survey, so the phone closes it as well.
  await field.sync();
  expect((await field.query<Rows>('field.assignment.list')).items[0]).toMatchObject({
    open: false,
    done: true,
    doneSync: 'accepted',
    reports: 2,
  });

  // At the desk: read the nameplate, accept it, match the EAM asset and file.
  await survey.command('assignment.extraction.create', {
    title: 'Read the breaker',
    scope: { reportId: placed.id },
    assignee: { type: 'target', id: 'model' },
  });
  await survey.settle();
  const reading = (await survey.query('capture.get', { id: placed.id })).extraction;
  await survey.command('assignment.extraction.accept', { id: reading.reportId, values: lines });
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
  const one = await openPhone(survey.hub.url, await survey.enrollment('Phone 1'), 'phone-1', [
    'cap-1',
  ]);
  const two = await openPhone(survey.hub.url, await survey.enrollment('Phone 2'), 'phone-2', [
    'cap-x',
    'cap-1',
  ]);
  const first = await survey.send('Generator 1', g1.id, one.deviceId);
  const second = await survey.send('Generator 2', g2.id, two.deviceId);
  await one.sync();
  await two.sync();
  expect((await two.query<Rows>('field.assignment.list')).items.map((a) => a.id)).toEqual([
    second.id,
  ]);

  // A node outside the survey reaches the hub unplaced; the hub decides what a survey covers.
  await two.capture(second.id, g1.id, { serial: 'X' });
  expect(await two.deliver()).toMatchObject({ accepted: 1 });
  expect(await survey.query('capture.get', { id: 'cap-x' })).not.toHaveProperty('nodeId');

  // The hub already holds a capture with this ID from the other phone, so it refuses this one.
  await one.capture(first.id, g1.id, { serial: 'A' });
  await one.deliver();
  await two.capture(second.id, g2.id, { serial: 'B' });
  expect(await two.deliver()).toMatchObject({ rejected: 1 });
  expect((await two.query<Rows>('field.report.list')).items[0]).toMatchObject({
    id: 'cap-1',
    sync: 'rejected',
    rejection: { code: 'CONFLICT' },
  });
  expect(await two.query('field.hub.status')).toMatchObject({ rejected: 1, pending: 0 });
});

test('a capture waits while the hub serves a changed assignment.survey.report', async () => {
  const survey = await startHub();
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const field = await openPhone(survey.hub.url, await survey.enrollment('Phone 1'));
  // The first call to the hub reads its contract.
  field.link.drifted = true;
  const assignment = await survey.send('Generator 1', g1.id, field.deviceId);
  await field.sync();
  expect((await field.query<Rows>('field.assignment.list')).items).toHaveLength(1);

  await field.capture(assignment.id, g1.id, { serial: 'A' });
  expect(await field.deliver()).toMatchObject({ accepted: 0 });
  expect(
    (
      await field.phone.instance.application.pendingEffects(
        { workspaceId: LOCAL_WORKSPACE, principalId: 'integration' },
        { target: 'hub' },
      )
    ).map((effect) => effect.lastFailure),
  ).toEqual([
    'assignment.survey.report changed on hub; calls wait until the two applications agree',
  ]);
  expect((await survey.query<Rows>('capture.list')).items).toEqual([]);
  expect(await field.query('field.hub.status')).toMatchObject({ pending: 1, accepted: 0 });
});
