import { describe, expect, test } from 'bun:test';
import { buildCatalog } from '@agent-native/contracts';
import {
  agentGrant,
  createApplication,
  createMemoryStorage,
  type ExecutionContext,
} from '@agent-native/runtime';
import { expireJob } from '../automation';
import { createLineHandlers, createLineState, lineStationModule, linePolicy } from '../server';

const T0 = 1_760_000_000_000;
const workspaceId = 'plant';
const as = (principalId: string): ExecutionContext => ({ workspaceId, principalId });
const sam = as('sam');
const olga = as('olga');
const vic = as('vic');

function setup() {
  let ids = 0;
  let clock = T0;
  let keys = 0;
  const state = createLineState({
    stations: [
      {
        id: 'line-1',
        name: 'Filler 1',
        line: 'Line 1',
        members: { sam: 'supervisor', olga: 'operator', vic: 'viewer' },
      },
      { id: 'line-2', name: 'Filler 2', line: 'Line 2', members: { sam: 'supervisor' } },
    ],
  });
  state.reasons.JAM = { code: 'JAM', text: 'Jam at infeed', category: 'unplanned' };
  for (const [id, station] of [
    ['s1', 'line-1'],
    ['s2', 'line-2'],
  ] as const)
    state.stops[id] = { id, station, state: 'ALARM', alarm: 'E42 infeed jam', startedAt: T0 };
  const app = createApplication({
    modules: [lineStationModule],
    handlers: createLineHandlers(),
    storage: createMemoryStorage(state),
    authorization: linePolicy,
    services: { newId: () => `p${++ids}`, now: () => clock },
    now: () => clock,
  });
  const command = (operation: string, input: unknown, context: ExecutionContext) =>
    app.invokeRaw({ operation, input, idempotencyKey: `k${++keys}` }, context);
  const query = async (operation: string, input: unknown, context = olga): Promise<any> =>
    (await app.queryRaw({ operation, input }, context)).data;
  /** Run the expiry job once as `as`, the way the automation plugin calls it. */
  const expire = (as: ExecutionContext) =>
    expireJob(() => clock)({
      trigger: 'expire-approval-requests',
      signal: new AbortController().signal,
      query: (operation, input) => app.queryRaw({ operation, input }, as) as never,
      command: (operation, input) => command(operation, input, as) as never,
    });
  return { command, query, expire, advance: (ms: number) => (clock += ms) };
}

/** A stop explainer run started by `issuer`. */
const explainer = (issuer: ExecutionContext): ExecutionContext => ({
  ...issuer,
  runId: 'run-1',
  grant: agentGrant(buildCatalog([lineStationModule]), 'stop.explainer', issuer, {
    runId: 'run-1',
    now: T0,
  }),
});
const classifyJam = (stopId: string) => ({
  operation: 'line.stop.classify',
  input: { stopId, reason: 'JAM' },
  rationale: 'Alarm E42 is the infeed jam sensor.',
  confidence: 0.8,
  resource: `stop:${stopId}`,
  baseRevisions: { [`stop:${stopId}`]: 0 },
});

describe('stop explainer approvals', () => {
  test('the explainer requests approval; an operator approves and the stop is classified as the operator', async () => {
    const { command, query } = setup();
    const agent = explainer(olga);
    // The run reads and requests approval but cannot classify, at its station only.
    await expect(
      command('line.stop.classify', { stopId: 's1', reason: 'JAM' }, agent),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await command('approval.request', classifyJam('s1'), agent);
    expect(
      (await query('approval.list', { status: 'pending', resource: 'stop:s1' }, vic)).items,
    ).toHaveLength(1);
    // A viewer sees the approval request but may not decide it; the delegated run may not approve it.
    for (const context of [vic, agent])
      await expect(command('approval.approve', { id: 'p1' }, context)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    const approved = await command('approval.approve', { id: 'p1' }, olga);
    expect(approved.continuation).toMatchObject({
      operation: 'line.stop.classify',
      result: { reason: 'JAM', sync: 'pending' },
    });
    expect((await query('line.stop.list', { station: 'line-1' })).items[0]).toMatchObject({
      reason: 'JAM',
      classifiedBy: 'olga',
    });
  });

  test('a run requests approval and sees approvals only at stations where its starter works', async () => {
    const { command, query } = setup();
    await expect(
      command('approval.request', classifyJam('s2'), explainer(olga)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await command('approval.request', classifyJam('s2'), explainer(sam));
    expect((await query('approval.list', {}, explainer(olga))).total).toBe(0);
    expect((await query('approval.list', {}, olga)).total).toBe(0);
    expect((await query('approval.list', {}, sam)).total).toBe(1);
    await expect(query('approval.get', { id: 'p1' }, olga)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('a stop classified since the approval conflicts; a demoted operator is refused', async () => {
    const { command, query } = setup();
    const agent = explainer(sam);
    await command('approval.request', classifyJam('s1'), agent);
    await command('approval.request', { ...classifyJam('s1'), rationale: 'Second look.' }, agent);
    await command(
      'line.station.set-member',
      { station: 'line-1', principalId: 'olga', role: 'viewer' },
      sam,
    );
    await expect(command('approval.approve', { id: 'p1' }, olga)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await command('line.stop.classify', { stopId: 's1', reason: 'JAM' }, sam);
    await expect(command('approval.approve', { id: 'p2' }, sam)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // Both stay open; the clock is fixed, so they are listed in ID order.
    expect(
      (await query('approval.list', { status: 'pending' }, sam)).items.map((item: any) => item.id),
    ).toEqual(['p1', 'p2']);
  });

  test('the expiry job closes only expired approvals at the stations of the person who enabled it', async () => {
    const { command, query, expire, advance } = setup();
    await command('approval.request', classifyJam('s1'), explainer(sam));
    await command('approval.request', classifyJam('s2'), explainer(sam));
    await expire(olga);
    expect((await query('approval.list', { status: 'pending' }, sam)).total).toBe(2);
    advance(24 * 60 * 60 * 1000);
    // Olga works only at line-1, so her run closes only the approval request there.
    await expire(olga);
    expect(
      (await query('approval.list', { status: 'pending' }, sam)).items.map((item: any) => item.id),
    ).toEqual(['p2']);
  });
});
