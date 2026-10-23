import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '@agent-native/runtime';
import {
  at,
  device,
  dispatched,
  open,
  otherDevice,
  owner,
  rita,
  vic,
  type Field,
  type Node,
} from './survey';

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
    const tree = await query<{ nodes: { designation: string; depth: number }[] }>(
      'structure.tree',
      {},
    );
    expect(tree.nodes.map((item) => item.designation)).toEqual(['=G1-Q1', '1LBA10AA101', '50/51N']);
    // A retired designation is free again.
    await node(undefined, '=G1', 'Generator 1 (rebuilt)');
    const found = await query<{ items: Node[] }>('structure.node.search', { q: '=g1' });
    expect(found.items.map((item) => item.designation)).toEqual(['=G1', '=G1-Q1']);
  });

  test('proposed nodes wait for a person to accept them and stay out of field work', async () => {
    const { command, query, node } = await open();
    const g1 = await node(undefined, '=G1', 'Generator 1');
    const proposed = await command<Node & { source: string }>(
      'structure.node.propose',
      { parentId: g1.id, scheme: 'iec81346', designation: '=G1-T1', name: 'Transformer' },
      rita,
    );
    expect(proposed.source).toBe('proposed');
    expect((await query<{ items: Node[] }>('structure.node.search', { q: '=G1-T' })).items).toEqual(
      [],
    );
    await expect(command('structure.node.accept', { id: proposed.id }, rita)).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
    const agent: ExecutionContext = {
      ...owner,
      runId: 'run-1',
      grant: {
        operations: ['structure.node.accept', 'structure.node.propose'],
        runId: 'run-1',
        principalId: 'owner',
      },
    };
    await expect(
      command('structure.node.accept', { id: proposed.id }, agent),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const accepted = await command<{ source: string }>('structure.node.accept', {
      id: proposed.id,
    });
    expect(accepted.source).toBe('accepted');
  });

  test('a dispatched assignment reaches only its device, with its structure slice', async () => {
    const survey = await open();
    const { query, command } = survey;
    const { g1, q1, assignment } = await dispatched(survey);
    await survey.node(undefined, '=G2', 'Generator 2');

    type Feed = {
      items: { id: string; nodes: { id: string; parentId?: string; designation: string }[] }[];
      cursor: string;
    };
    const feed = await query<Feed>('assignment.feed', {}, device);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]!.nodes.map((item) => item.designation)).toEqual([
      '=G1',
      '=G1-Q1',
      '=G1-Q2',
    ]);
    expect(feed.items[0]!.nodes[0]!.parentId).toBeUndefined();
    expect((await query<Feed>('assignment.feed', { cursor: feed.cursor }, device)).items).toEqual(
      [],
    );
    expect((await query<Feed>('assignment.feed', {}, otherDevice)).items).toEqual([]);

    // A change to the slice moves the cursor, so the device picks it up.
    await command('structure.node.update', { id: q1.id, name: 'Main breaker' });
    expect(
      (await query<Feed>('assignment.feed', { cursor: feed.cursor }, device)).items,
    ).toHaveLength(1);

    // People do not read the feed, and the device reads nothing else.
    await expect(query('assignment.feed', {}, owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(query('structure.tree', {}, device)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(command('structure.node.retire', { id: g1.id }, device)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(
      command('assignment.return', { id: assignment.id }, otherDevice),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const returned = await command<{ stage: string }>(
      'assignment.return',
      { id: assignment.id },
      device,
    );
    expect(returned.stage).toBe('returned');
  });

  test('ingest is idempotent by capture ID and only for the device the assignment went to', async () => {
    const survey = await open();
    const { query, command, photo } = survey;
    const { q1, assignment } = await dispatched(survey);
    const plate = await photo({ manufacturer: 'ABB', serial: '1VYN300101' });
    const capture = {
      id: 'cap-1',
      assignmentId: assignment.id,
      nodeId: q1.id,
      kind: 'nameplate',
      photos: [plate],
      codes: [],
      note: '',
      takenAt: 1_000,
    };
    await command('capture.ingest', capture, device);
    await command('capture.ingest', capture, device);
    await expect(
      command('capture.ingest', { ...capture, takenAt: 2_000 }, device),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(
      command('capture.ingest', { ...capture, id: 'cap-2' }, otherDevice),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      command('capture.ingest', { ...capture, id: 'cap-3' }, owner),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // A node outside the assignment arrives unplaced.
    const g2 = await survey.node(undefined, '=G2', 'Generator 2');
    await command(
      'capture.ingest',
      { ...capture, id: 'cap-4', nodeId: g2.id, takenAt: 3_000 },
      device,
    );
    const unplaced = await query<{ items: { id: string }[] }>('capture.list', { unplaced: true });
    expect(unplaced.items.map((item) => item.id)).toEqual(['cap-4']);
    expect(
      (await query<{ items: { stage: string }[] }>('assignment.list', {})).items[0]!.stage,
    ).toBe('in-field');
    await command('capture.place', { id: 'cap-4', nodeId: q1.id }, rita);
    await command('capture.discard', { id: 'cap-4', reason: 'Duplicate' }, rita);
    await expect(
      command('capture.place', { id: 'cap-4', nodeId: q1.id }, vic),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('a reviewer accepts what the model read, and the EAM decides on the filing', async () => {
    const survey = await open();
    const { query, command, photo, settle } = survey;
    const { q1, q2, assignment } = await dispatched(survey);
    const ingest = async (id: string, nodeId: string, lines: Record<string, string>) =>
      command(
        'capture.ingest',
        {
          id,
          assignmentId: assignment.id,
          nodeId,
          kind: 'nameplate',
          photos: [await photo(lines)],
          codes: [],
          note: '',
          takenAt: 1_000,
        },
        device,
      );
    await ingest('cap-q1', q1.id, {
      manufacturer: 'ABB',
      serial: '1VYN300101',
      ratedCurrent: '6300 A ?',
    });
    await ingest('cap-q2', q2.id, { manufacturer: 'Siemens', ratedVoltage: '24 kV' });
    await command('assignment.return', { id: assignment.id }, device);

    await command('extraction.request', { captureId: 'cap-q1' }, rita);
    await command('extraction.request', { captureId: 'cap-q2' }, rita);
    await expect(command('extraction.request', { captureId: 'cap-q2' }, vic)).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
    await settle();
    const detail = await query<{ extraction: { status: string; fields: Field[] } }>('capture.get', {
      id: 'cap-q1',
    });
    expect(detail.extraction.status).toBe('proposed');
    expect(
      detail.extraction.fields.map(({ name, value, attention }) => [name, value, attention]),
    ).toEqual([
      ['manufacturer', 'ABB', false],
      ['serial', '1VYN300101', false],
      ['ratedCurrent', '6300 A', true],
    ]);
    expect(await query('extraction.status', {})).toMatchObject({ proposed: 2, attention: 1 });

    // The reviewer corrects the uncertain value; the node records that it was edited.
    const accepted = await command<Node>(
      'extraction.accept',
      {
        captureId: 'cap-q1',
        values: { manufacturer: 'ABB', serial: '1VYN300101', ratedCurrent: '6300 A' },
      },
      rita,
    );
    expect(accepted.attributes.ratedCurrent).toMatchObject({ value: '6300 A', edited: false });
    await command(
      'extraction.accept',
      { captureId: 'cap-q2', values: { manufacturer: 'Siemens', ratedVoltage: '25 kV' } },
      rita,
    );
    expect(
      (await query<{ attributes: Node['attributes'] }>('structure.node.get', { id: q2.id }))
        .attributes.ratedVoltage,
    ).toMatchObject({
      value: '25 kV',
      edited: true,
    });
    expect(
      (await query<{ items: { stage: string }[] }>('assignment.list', {})).items[0]!.stage,
    ).toBe('processed');

    // Q1 already exists in the EAM; Q2 has no serial. Creating either is refused.
    await expect(command('filing.file', { nodeId: q1.id }, rita)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await command('filing.file', { nodeId: q1.id });
    await command('filing.file', { nodeId: q2.id });
    await expect(command('filing.file', { nodeId: q2.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await settle();
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
    await settle();
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
    await settle();
    expect(await query<Node>('structure.node.get', { id: q1.id })).toMatchObject({
      assetStatus: 'retired',
    });
  });

  test('the model and EAM feeds sync as one principal before either reported anything', async () => {
    const survey = await open();
    await survey.settle();
    await survey.settle();
    expect(await survey.query('filing.status', {})).toMatchObject({ pending: 0, accepted: 0 });
  });

  test('a filing waits while the EAM is unreachable and goes out once it is back', async () => {
    const survey = await open();
    const { query, command, photo, settle } = survey;
    const { q2, assignment } = await dispatched(survey);
    await command(
      'capture.ingest',
      {
        id: 'cap',
        assignmentId: assignment.id,
        nodeId: q2.id,
        kind: 'nameplate',
        photos: [await photo({ serial: 'S-77' })],
        codes: [],
        note: '',
        takenAt: 1,
      },
      device,
    );
    await command('extraction.request', { captureId: 'cap' }, rita);
    await settle();
    await command('extraction.accept', { captureId: 'cap', values: { serial: 'S-77' } }, rita);
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
    await expect(query('structure.tree', {}, at('eve'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(query('structure.tree', {}, at('integration'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await query<unknown>('structure.tree', {}, vic)).toEqual({ nodes: [] });
  });
});
