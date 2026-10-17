import { describe, expect, test } from 'bun:test';
import { buildCatalog } from '@agent-native/contracts';
import {
  agentGrant,
  createApplication,
  createMemoryStorage,
  type ExecutionContext,
} from '@agent-native/runtime';
import { createLineHandlers, createLineState, lineStationModule, linePolicy } from '../server';

const T0 = 1_760_000_000_000;
const workspaceId = 'plant';
const as = (principalId: string): ExecutionContext => ({ workspaceId, principalId });
const sam = as('sam');
const olga = as('olga');
const vic = as('vic');

function setup() {
  let ids = 0;
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
    services: { newId: () => `p${++ids}`, now: () => T0 },
    now: () => T0,
  });
  const command = (operation: string, input: unknown, context: ExecutionContext) =>
    app.invokeRaw({ operation, input, idempotencyKey: `k${++keys}` }, context);
  const query = async (operation: string, input: unknown, context = olga): Promise<any> =>
    (await app.queryRaw({ operation, input }, context)).data;
  return { command, query };
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

describe('stop explainer proposals', () => {
  test('the explainer proposes; an operator accepts and the stop is classified as the operator', async () => {
    const { command, query } = setup();
    const agent = explainer(olga);
    // The run reads and proposes but cannot classify, at its station only.
    await expect(
      command('line.stop.classify', { stopId: 's1', reason: 'JAM' }, agent),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await command('proposal.submit', classifyJam('s1'), agent);
    expect(
      (await query('proposal.list', { status: 'open', resource: 'stop:s1' }, vic)).items,
    ).toHaveLength(1);
    // A viewer sees the proposal but may not decide it; the delegated run may not accept it.
    for (const context of [vic, agent])
      await expect(command('proposal.accept', { id: 'p1' }, context)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    const accepted = await command('proposal.accept', { id: 'p1' }, olga);
    expect(accepted.continuation).toMatchObject({
      operation: 'line.stop.classify',
      result: { reason: 'JAM', sync: 'pending' },
    });
    expect((await query('line.stop.list', { station: 'line-1' })).items[0]).toMatchObject({
      reason: 'JAM',
      classifiedBy: 'olga',
    });
  });

  test('a run proposes and sees proposals only at stations where its starter works', async () => {
    const { command, query } = setup();
    await expect(
      command('proposal.submit', classifyJam('s2'), explainer(olga)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await command('proposal.submit', classifyJam('s2'), explainer(sam));
    expect((await query('proposal.list', {}, explainer(olga))).total).toBe(0);
    expect((await query('proposal.list', {}, olga)).total).toBe(0);
    expect((await query('proposal.list', {}, sam)).total).toBe(1);
    await expect(query('proposal.get', { id: 'p1' }, olga)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('a stop classified since the proposal conflicts; a demoted operator is refused', async () => {
    const { command, query } = setup();
    const agent = explainer(sam);
    await command('proposal.submit', classifyJam('s1'), agent);
    await command('proposal.submit', { ...classifyJam('s1'), rationale: 'Second look.' }, agent);
    await command(
      'line.station.set-member',
      { station: 'line-1', principalId: 'olga', role: 'viewer' },
      sam,
    );
    await expect(command('proposal.accept', { id: 'p1' }, olga)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await command('line.stop.classify', { stopId: 's1', reason: 'JAM' }, sam);
    await expect(command('proposal.accept', { id: 'p2' }, sam)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // Both stay open; the clock is fixed, so they are listed in ID order.
    expect(
      (await query('proposal.list', { status: 'open' }, sam)).items.map((item: any) => item.id),
    ).toEqual(['p1', 'p2']);
  });
});
