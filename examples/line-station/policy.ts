import { targetLane, targetRules } from '@agent-native/integration';
import { definePolicy, membershipRule, type OperationRule } from '@agent-native/runtime';
import { mesTarget, operations } from './contracts';
import { stationMembership } from './contracts/membership';
import { bridgeStation, own, stationRole, type LineState, type StationRole } from './domain';

/** Resolve the station that governs read access to a journal resource. */
export function stationOfResource(state: LineState, resource: string): string | undefined {
  const separator = resource.indexOf(':');
  const type = resource.slice(0, separator);
  const id = resource.slice(separator + 1);
  if (type === 'station' || type === 'counters') return own(state.stations, id) ? id : undefined;
  if (type === 'stop') return own(state.stops, id)?.station;
  if (type === 'count') return own(state.counts, id)?.station;
  if (type === 'attention') return own(state.attention, id)?.station;
  if (type === 'order') return own(state.orders, id)?.station;
  // A proposal belongs to the station of the record it is about.
  if (type === 'proposal') {
    const about = own(state.proposals, id)?.resource;
    return about && !about.startsWith('proposal:') ? stationOfResource(state, about) : undefined;
  }
  return undefined;
}

type Rule = OperationRule<LineState, StationRole>;
const operate: StationRole[] = ['operator', 'supervisor'];
/**
 * An operation at one station, resolved from authoritative state, never from caller claims. A
 * resource-limited delegation names stations; it cannot reach other stations.
 */
const atStation = (
  station: (input: Record<string, unknown>, state: LineState) => string | undefined,
  roles: StationRole[] = operate,
): Rule => ({
  container: (input, state) => station(input, state),
  grant: (input, state) => {
    const id = station(input, state);
    return id === undefined ? undefined : `station:${id}`;
  },
  roles,
});
const proposalStation = (input: Record<string, unknown>, state: LineState) =>
  stationOfResource(state, `proposal:${String(input.id)}`);
const named = (input: Record<string, unknown>) =>
  typeof input.station === 'string' ? input.station : undefined;
/**
 * Commands that stand for a person at the station: starting an order (hazard: the machine loads
 * a recipe), verifying what the screen shows, reconciling an interrupted procedure and taking or
 * handing back the screen. Delegated agent runs may read, propose and classify, never these.
 */
const person = (rule: Rule): Rule => ({ ...rule, person: true, reason: 'PERSON_AT_STATION' });
const stationEvent = (type: string) => ({
  container: (id: string, state: LineState) => stationOfResource(state, `${type}:${id}`),
});

/**
 * Station-scoped policy. Roles come from authoritative state. Integration principals are
 * separate and narrow: a station bridge acts only for its own station, the MES integration only
 * on master data and MES outcomes, and neither can do what people do. Which target an
 * integration principal may settle is checked by the settle handler against the effect itself,
 * inside the same transaction. Commands are evaluated against current and proposed state.
 */
export const linePolicy = definePolicy<LineState, StationRole>({
  roleOf: stationRole,
  integrations: [
    {
      is: (state, principalId) => bridgeStation(state, principalId) !== undefined,
      operations: [
        operations.observationIngest.id,
        operations.controlGet.id,
        operations.effectSettle.id,
      ],
      // Its own station only; settle names no station and is checked against the effect.
      allow: ({ capability, input, state, context }) =>
        capability.id === operations.effectSettle.id ||
        (input as { station?: unknown }).station === bridgeStation(state, context.principalId)!.id,
      events: (event, state, principalId) =>
        stationOfResource(state, event.resource) === bridgeStation(state, principalId)!.id,
    },
    targetLane(mesTarget, (state, principalId) => principalId === state.mesPrincipalId),
  ],
  operations: {
    [operations.observationIngest.id]: 'integration',
    [operations.controlGet.id]: 'integration',
    ...targetRules(mesTarget),
    // Handlers scope these to the caller's stations before filtering and counting.
    [operations.stationList.id]: 'open',
    [operations.reasonList.id]: 'open',
    // Reconcile names an effect; the handler resolves its station and checks the role there.
    [operations.effectReconcile.id]: person({}),
    [operations.stationGet.id]: atStation(named),
    [operations.orderList.id]: atStation(named),
    [operations.stopList.id]: atStation(named),
    [operations.attentionList.id]: atStation(named),
    [operations.countConfirm.id]: atStation(named),
    [operations.orderStart.id]: person(atStation(named)),
    [operations.seatRequest.id]: person(atStation(named)),
    [operations.stopClassify.id]: atStation(
      (input, state) => own(state.stops, String(input.stopId))?.station,
    ),
    [operations.readingConfirm.id]: person(
      atStation((input, state) => own(state.attention, String(input.attentionId))?.station),
    ),
    [operations.bridgeSetMode.id]: atStation(named, ['supervisor']),
    // A proposal is about a record at one station; submitting needs a role there, and deciding
    // needs a person with an operating role there. Accepting then also passes the proposed
    // command's own rule, under the accepter.
    [operations.proposalSubmit.id]: atStation((input, state) =>
      typeof input.resource === 'string' ? stationOfResource(state, input.resource) : undefined,
    ),
    [operations.proposalAccept.id]: person(atStation(proposalStation)),
    [operations.proposalReject.id]: person(atStation(proposalStation)),
    [operations.proposalExpire.id]: atStation(proposalStation, [
      'operator',
      'supervisor',
      'viewer',
    ]),
    // Handlers scope these to proposals at the caller's stations before filtering and counting.
    [operations.proposalList.id]: 'open',
    [operations.proposalGet.id]: 'open',
    [operations.stationSetMember.id]: {
      ...membershipRule(stationMembership),
      grant: (input) => `station:${String(input.station)}`,
    },
  },
  events: {
    station: stationEvent('station'),
    counters: stationEvent('counters'),
    stop: stationEvent('stop'),
    count: stationEvent('count'),
    attention: stationEvent('attention'),
    order: stationEvent('order'),
    proposal: stationEvent('proposal'),
    // MES master-data changes are visible to anyone who works at some station.
    sync: (id, state, context) =>
      id === mesTarget.target &&
      Object.keys(state.stations).some((station) =>
        stationRole(state, context.principalId, station),
      ),
  },
});
