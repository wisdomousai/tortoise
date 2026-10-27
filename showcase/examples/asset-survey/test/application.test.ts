import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '@agent-native/runtime';
import { at, device, dispatched, open, otherDevice, owner, rita, vic, type Node } from './survey';

type Tree = { items: { designation: string; depth: number }[]; total: number };

describe('asset survey', () => {
  test('the structure validates designations per scheme and keeps them unique', async () => {
    const { command, query, node } = await open();
    const g1 = await node(undefined, '=g1', 'Generator 1');
    expect(g1.designation).toBe('=G1');
    const q1 = await node(g1.id, '=G1-Q1', 'Breaker');
    expect(q1.label).toBeString();
    await expect(node(g1.id, ' =g1-q1', 'Twin')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(node(g1.id, 'G1Q1', 'Bad')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // The same text in another scheme is another designation space.
    await expect(
      command('structure.node.create', { scheme: 'kks', designation: '=G1-Q1', name: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await command('structure.node.create', {
      scheme: 'kks',
      designation: '1LBA10AA101',
      name: 'Valve',
    });
    await command('structure.node.create', {
      scheme: 'ansi',
      designation: '50/51N',
      name: 'Relay',
    });

    await expect(
      command('structure.node.move', { id: g1.id, parentId: q1.id }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(command('structure.node.retire', { id: g1.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await command('structure.node.move', { id: q1.id, parentId: null });
    await command('structure.node.retire', { id: g1.id });
    await expect(
      command('structure.node.update', { id: g1.id, name: 'Generator 1 (old)' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const tree = await query<Tree>('structure.tree', {});
    expect(tree.items.map((item) => item.designation)).toEqual(['=G1-Q1', '1LBA10AA101', '50/51N']);
    // A retired designation is free again.
    await node(undefined, '=G1', 'Generator 1 (rebuilt)');
    const found = await query<{ items: Node[] }>('structure.node.search', { q: '=g1' });
    expect(found.items.map((item) => item.designation)).toEqual(['=G1', '=G1-Q1']);
  });

  test('an agent requests a node, and only a manager in person approves it', async () => {
    const { command, query, node } = await open();
    const g1 = await node(undefined, '=G1', 'Generator 1');
    const agent: ExecutionContext = {
      ...at('rita'),
      runId: 'run-1',
      grant: { operations: ['approval.request'], runId: 'run-1', principalId: 'rita' },
    };
    const request = await command<{ id: string; status: string }>(
      'approval.request',
      {
        operation: 'structure.node.create',
        input: { parentId: g1.id, scheme: 'iec81346', designation: '=G1-T1', name: 'Transformer' },
        rationale: 'The single-line diagram shows T1 under =G1',
      },
      agent,
    );
    expect(request.status).toBe('pending');
    // Nothing exists until it is approved.
    expect((await query<{ items: Node[] }>('structure.node.search', { q: '=G1-T' })).items).toEqual(
      [],
    );
    await expect(
      command(
        'approval.request',
        { operation: 'structure.node.create', input: {}, rationale: 'x' },
        vic,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(command('approval.approve', { id: request.id }, rita)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const delegated: ExecutionContext = {
      ...owner,
      runId: 'run-2',
      grant: { operations: ['approval.approve'], runId: 'run-2', principalId: 'owner' },
    };
    await expect(command('approval.approve', { id: request.id }, delegated)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await command('approval.approve', { id: request.id });
    const found = await query<{ items: Node[] }>('structure.node.search', { q: '=G1-T' });
    expect(found.items.map((item) => item.designation)).toEqual(['=G1-T1']);
  });

  test('a survey reaches only its device, with its structure slice', async () => {
    const survey = await open();
    const { query, command } = survey;
    const { g1, q1, assignment } = await dispatched(survey);
    await survey.node(undefined, '=G2', 'Generator 2');

    type Feed = {
      items: {
        id: string;
        brief: { nodes: { id: string; parentId?: string; designation: string }[] };
      }[];
      cursor: string;
    };
    const feed = await query<Feed>('assignment.feed', {}, device);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]!.brief.nodes.map((item) => item.designation).sort()).toEqual([
      '=G1',
      '=G1-Q1',
      '=G1-Q2',
    ]);
    expect(feed.items[0]!.brief.nodes.find((item) => item.id === g1.id)!.parentId).toBeUndefined();
    expect((await query<Feed>('assignment.feed', { cursor: feed.cursor }, device)).items).toEqual(
      [],
    );
    expect((await query<Feed>('assignment.feed', {}, otherDevice)).items).toEqual([]);
    // The brief is the slice as it stood when sent; a later rename reaches the next survey.
    await command('structure.node.update', { id: q1.id, name: 'Main breaker' });
    expect((await query<Feed>('assignment.feed', { cursor: feed.cursor }, device)).items).toEqual(
      [],
    );

    // A manager's own feed holds nothing sent to the device; a viewer takes no work.
    expect((await query<Feed>('assignment.feed', {}, owner)).items).toEqual([]);
    await expect(query('assignment.feed', {}, vic)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The device reads nothing else.
    await expect(query('structure.tree', {}, device)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(command('structure.node.retire', { id: g1.id }, device)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(query('assignment.list', {}, device)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(
      command('assignment.complete', { id: assignment.id }, otherDevice),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const done = await command<{ status: string }>(
      'assignment.complete',
      { id: assignment.id },
      device,
    );
    expect(done.status).toBe('done');
  });

  test('a report is idempotent by ID and only from the device the survey went to', async () => {
    const survey = await open();
    const { query, command, capture } = survey;
    const { q1, assignment } = await dispatched(survey);
    const body = {
      kind: 'nameplate',
      photos: [await survey.photo({ manufacturer: 'ABB', serial: '1VYN300101' })],
      codes: [],
      note: '',
      takenAt: 1_000,
    };
    const report = { id: 'cap-1', assignmentId: assignment.id, subject: q1.id, body };
    await command('assignment.survey.report', report, device);
    await command('assignment.survey.report', report, device);
    await expect(
      command('assignment.survey.report', { ...report, body: { ...body, takenAt: 2_000 } }, device),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      command('assignment.survey.report', { ...report, id: 'cap-2' }, otherDevice),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      command('assignment.survey.report', { ...report, id: 'cap-3' }, owner),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A capture of a node outside the survey is recorded unlinked, for a reviewer to link within the survey.
    const g2 = await survey.node(undefined, '=G2', 'Generator 2');
    await capture('cap-4', assignment.id, g2.id, { serial: 'X' }, { takenAt: 3_000 });
    const unlinked = await query<{ items: { id: string }[] }>('capture.list', { unlinked: true });
    expect(unlinked.items.map((item) => item.id)).toEqual(['cap-4']);
    expect(
      (await query<{ items: { stage: string }[] }>('assignment.list', {})).items[0]!.stage,
    ).toBe('working');
    await expect(
      command('assignment.report.link', { id: 'cap-4', subject: g2.id }, rita),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await command('assignment.report.link', { id: 'cap-4', subject: q1.id }, rita);
    await command('assignment.report.discard', { id: 'cap-4', reason: 'Duplicate' }, rita);
    await expect(
      command('assignment.report.link', { id: 'cap-4', subject: q1.id }, vic),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('a reviewer accepts what the model read, and the EAM decides on the filing', async () => {
    const survey = await open();
    const { query, command, capture, complete } = survey;
    const { q1, q2, assignment } = await dispatched(survey);
    await capture('cap-q1', assignment.id, q1.id, {
      manufacturer: 'ABB',
      serial: '1VYN300101',
      ratedCurrent: '6300 A ?',
    });
    await capture('cap-q2', assignment.id, q2.id, {
      manufacturer: 'Siemens',
      ratedVoltage: '24 kV',
    });
    await command('assignment.complete', { id: assignment.id }, device);

    await survey.read('cap-q1');
    await survey.read('cap-q2');
    await expect(survey.read('cap-q2', vic)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await query('assignment.model.status', {})).toMatchObject({ waiting: 2, refused: 0 });
    await complete();
    const q1Reading = await survey.reading('cap-q1');
    expect(q1Reading.status).toBe('proposed');
    expect(q1Reading.fields.map(({ name, value, attention }) => [name, value, attention])).toEqual([
      ['manufacturer', 'ABB', false],
      ['serial', '1VYN300101', false],
      ['ratedCurrent', '6300 A', true],
    ]);
    const queue = await query<{ items: { reading?: string; attention: boolean }[] }>(
      'capture.list',
      { review: 'new' },
    );
    expect(queue.items.map((item) => [item.reading, item.attention]).sort()).toEqual([
      ['proposed', false],
      ['proposed', true],
    ]);

    // The reviewer corrects the uncertain value; the node records that it was edited.
    await command(
      'assignment.extraction.accept',
      {
        id: q1Reading.reportId,
        values: { manufacturer: 'ABB', serial: '1VYN300101', ratedCurrent: '6300 A' },
      },
      rita,
    );
    expect(
      (await query<Node>('structure.node.get', { id: q1.id })).attributes.ratedCurrent,
    ).toMatchObject({ value: '6300 A', edited: false });
    await command(
      'assignment.extraction.accept',
      {
        id: (await survey.reading('cap-q2')).reportId,
        values: { manufacturer: 'Siemens', ratedVoltage: '25 kV' },
      },
      rita,
    );
    expect(
      (await query<Node>('structure.node.get', { id: q2.id })).attributes.ratedVoltage,
    ).toMatchObject({ value: '25 kV', edited: true });
    expect((await query<{ review: string }>('capture.get', { id: 'cap-q2' })).review).toBe(
      'accepted',
    );
    const surveys = await query<{ items: { stage: string }[] }>('assignment.list', {
      kind: 'survey',
    });
    expect(surveys.items[0]!.stage).toBe('reviewed');

    // Q1 already exists in the EAM; Q2 has no serial. Creating either is refused.
    await expect(command('filing.file', { nodeId: q1.id }, rita)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await command('filing.file', { nodeId: q1.id });
    await command('filing.file', { nodeId: q2.id });
    await expect(command('filing.file', { nodeId: q2.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await complete();
    type Filings = { items: { nodeId: string; sync: string; rejection?: { code: string } }[] };
    const rejected = (await query<Filings>('filing.list', {})).items;
    expect(
      Object.fromEntries(rejected.map((filing) => [filing.nodeId, filing.rejection?.code])),
    ).toEqual({
      [q1.id]: 'DUPLICATE_DESIGNATION',
      [q2.id]: 'SERIAL_REQUIRED',
    });

    // The search names the matching asset; filing with its ID updates it with the evidence.
    const found = await query<{ items: { externalId: string }[] }>(
      'eam.asset.search',
      { q: '=G1-Q1' },
      vic,
    );
    expect(found.items.map((item) => item.externalId)).toEqual(['EAM-1001']);
    await command('filing.file', { nodeId: q1.id, assetId: 'EAM-1001' });
    await complete();
    const filed = await query<Node>('structure.node.get', { id: q1.id });
    expect(filed).toMatchObject({ assetId: 'EAM-1001', assetStatus: 'active' });
    const asset = survey.eam().assets.get('EAM-1001')!;
    expect(asset.attributes.ratedCurrent).toBe('6300 A');
    expect(asset.evidence).toHaveLength(1);
    expect(
      (await query<{ items: { nodeId?: string }[] }>('eam.asset.search', { q: '=G1-Q1' })).items[0]!
        .nodeId,
    ).toBe(q1.id);

    // The EAM's own users retire the asset; its feed reaches the node.
    survey.eam().retire('EAM-1001');
    await complete();
    expect(await query<Node>('structure.node.get', { id: q1.id })).toMatchObject({
      assetStatus: 'retired',
    });
  });

  test('a person surveys at a desk and reads a capture by hand instead of the model', async () => {
    const survey = await open();
    const { query, command, capture } = survey;
    const g1 = await survey.node(undefined, '=G1', 'Generator 1');
    const q1 = await survey.node(g1.id, '=G1-Q1', 'Breaker');
    const work = await command<{ id: string }>('assignment.survey.create', {
      title: 'Desk check of =G1',
      scope: { roots: [g1.id], kinds: ['nameplate'] },
      assignee: { type: 'person', id: 'rita' },
    });
    await expect(
      command('assignment.survey.create', {
        title: 'For a viewer',
        scope: { roots: [g1.id], kinds: ['nameplate'] },
        assignee: { type: 'person', id: 'vic' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await capture('desk-1', work.id, q1.id, { serial: 'S-1' }, { as: rita });
    const reading = await command<{ id: string }>(
      'assignment.extraction.create',
      {
        title: 'Read desk-1',
        scope: { reportId: 'desk-1' },
        assignee: { type: 'person', id: 'rita' },
      },
      owner,
    );
    const { digest } = (
      await query<{ photos: { digest: string }[] }>('capture.get', { id: 'desk-1' })
    ).photos[0]!;
    await command(
      'assignment.extraction.report',
      {
        id: 'by-hand-1',
        assignmentId: reading.id,
        body: {
          model: 'read by hand',
          fields: [{ name: 'serial', value: 'S-1', confidence: 1, source: { digest } }],
        },
      },
      rita,
    );
    expect((await survey.reading('desk-1')).status).toBe('proposed');
    await command('assignment.extraction.accept', { id: 'by-hand-1', values: { serial: 'S-1' } });
    expect(
      (await query<Node>('structure.node.get', { id: q1.id })).attributes.serial,
    ).toMatchObject({ value: 'S-1', edited: false });
  });

  test('the model and EAM feeds sync as one principal before either reported anything', async () => {
    const survey = await open();
    await survey.complete();
    await survey.complete();
    expect(await survey.query('filing.status', {})).toMatchObject({ pending: 0, accepted: 0 });
    expect(await survey.query('assignment.model.status', {})).toMatchObject({
      waiting: 0,
      refused: 0,
    });
  });

  test('a filing waits while the EAM is unreachable and goes out once it is back', async () => {
    const survey = await open();
    const { query, command, complete } = survey;
    const { q2, assignment } = await dispatched(survey);
    await survey.capture('cap', assignment.id, q2.id, { serial: 'S-77' });
    await survey.read('cap');
    await complete();
    await command(
      'assignment.extraction.accept',
      { id: (await survey.reading('cap')).reportId, values: { serial: 'S-77' } },
      rita,
    );
    survey.eam().unavailable = true;
    await command('filing.file', { nodeId: q2.id });
    expect(await survey.deliver('eam')).toMatchObject({ retried: 1 });
    expect(await query('filing.status', {})).toMatchObject({ pending: 1 });
    survey.eam().unavailable = false;
    // The next pass after the backoff delivers it once.
    await survey.retry();
    expect(await query('filing.status', {})).toMatchObject({ pending: 0, accepted: 1 });
    expect(survey.eam().assets.get('EAM-2001')?.attributes).toEqual({ serial: 'S-77' });
  });

  test('outsiders and the integration principal read nothing of the survey', async () => {
    const { query } = await open();
    for (const outsider of [at('eve'), at('integration')]) {
      await expect(query('structure.tree', {}, outsider)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(query('assignment.list', {}, outsider)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(await query<unknown>('structure.tree', {}, vic)).toEqual({ items: [], total: 0 });
  });
});
