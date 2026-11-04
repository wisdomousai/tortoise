import { targetAllowlist, targetRules } from '@tortoise/integration';
import {
  definePolicy,
  membershipRule,
  type ApprovalAccess,
  type ExecutionContext,
  type OperationRule,
} from '@tortoise/runtime';
import type { DeviceAccess } from '@tortoise/devices/server';
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
const named = (input: Record<string, unknown>) =>
  typeof input.station === 'string' ? input.station : undefined;
/**
 * Commands that stand for a person at the station: starting an order (risk: the machine loads
 * a recipe), verifying what the screen shows, reconciling an interrupted procedure and taking or
 * handing back the screen. Delegated agent runs may read and classify, never these.
 */
const person = (rule: Rule): Rule => ({ ...rule, person: true, reason: 'PERSON_AT_STATION' });
const stationEvent = (type: string) => ({
  container: (id: string, state: LineState) => stationOfResource(state, `${type}:${id}`),
});

/**
 * Station-scoped policy. Roles come from authoritative state. Integration principals are
 * separate and narrow: a station bridge acts only for its own station, the MES integration only
 * on master data and MES outcomes, and neither can do what people do. Which target an
 * integration principal may complete is checked by the complete handler against the effect itself,
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
        operations.effectComplete.id,
      ],
      // Its own station only; complete names no station and is checked against the effect.
      allow: ({ capability, input, state, context }) =>
        capability.id === operations.effectComplete.id ||
        (input as { station?: unknown }).station === bridgeStation(state, context.principalId)!.id,
      events: (event, state, principalId) =>
        stationOfResource(state, event.resource) === bridgeStation(state, principalId)!.id,
    },
    targetAllowlist(mesTarget, (state, principalId) => principalId === state.mesPrincipalId),
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
    [operations.controlRequest.id]: person(atStation(named)),
    [operations.stopClassify.id]: atStation(
      (input, state) => own(state.stops, String(input.stopId))?.station,
    ),
    [operations.readingConfirm.id]: person(
      atStation((input, state) => own(state.attention, String(input.attentionId))?.station),
    ),
    [operations.bridgeSetMode.id]: atStation(named, ['supervisor']),
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
    // MES master-data changes are visible to anyone who works at some station.
    sync: (id, state, context) =>
      id === mesTarget.target &&
      Object.keys(state.stations).some((station) =>
        stationRole(state, context.principalId, station),
      ),
  },
});

/**
 * The station `context` works at for `resource`, within a delegated grant's `station:<id>`
 * resources, or undefined.
 */
function workingStation(state: LineState, context: ExecutionContext, resource: string) {
  const station = stationOfResource(state, resource);
  if (station === undefined || !stationRole(state, context.principalId, station)) return undefined;
  const scope = context.grant?.resources;
  return !scope || scope.includes(`station:${station}`) ? station : undefined;
}

/**
 * Who may do what with approval requests, for the `approval` feature. An approval request names
 * the record it is about (`stop:<id>`) and takes that record's station: operators and
 * supervisors there request, approve and reject, viewers there also expire (the expiry job runs
 * as whoever enabled it), and every role there reads. Listing needs a role at some station. A
 * delegated grant's `station:<id>` resources narrow all of it; station bridges and the MES
 * integration hold no station role, so they reach none of it. Approving also passes the
 * requested command's own rule under the approver, and the feature refuses deciding to a
 * delegated caller.
 */
export const approvalAccess = (state: LineState): ApprovalAccess => ({
  allows(context, action, resource) {
    if (resource === undefined)
      return (
        action === 'read' &&
        Object.keys(state.stations).some(
          (station) => workingStation(state, context, `station:${station}`) !== undefined,
        )
      );
    const station = workingStation(state, context, resource);
    if (station === undefined) return false;
    const role = stationRole(state, context.principalId, station)!;
    if (action === 'read' || action === 'expire') return true;
    return operate.includes(role);
  },
});

/**
 * Device configuration follows station roles for the `device` feature: supervisors administer,
 * every other role reads. The feature applies a delegated grant's `device:<station>` resources.
 */
export const deviceAccess = (state: LineState): DeviceAccess => ({
  relation(context, station) {
    const role = stationRole(state, context.principalId, station);
    return role === 'supervisor' ? 'administer' : role ? 'read' : undefined;
  },
});
