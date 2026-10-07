import type { AuthorizationPort, ExecutionContext } from '@agent-native/runtime';
import { operations } from './contracts';
import { bridgeStation, own, stationRole, type LineState } from './domain';

const knownOperations = new Set<string>(Object.values(operations).map((operation) => operation.id));
/** Each station's bridge may observe, read its control state and settle its own procedures. */
const bridgeOperations = new Set<string>([
  operations.observationIngest.id,
  operations.controlGet.id,
  operations.effectSettle.id,
]);
/** The MES integration syncs master data, reads its watermark and settles MES records. */
const mesOperations = new Set<string>([
  operations.mesSync.id,
  operations.syncStatus.id,
  operations.effectSettle.id,
]);
/** Handlers scope these to the caller's stations before filtering and counting. */
const scopedInHandler = new Set<string>([
  operations.stationList.id,
  operations.reasonList.id,
  operations.syncStatus.id,
]);
/**
 * Commands that stand for a person at the station: starting an order (hazard: the machine loads
 * a recipe), verifying what the screen shows, reconciling an interrupted procedure and taking or
 * handing back the screen. Delegated agent runs may read, propose and classify, never these.
 */
export const personOnly = new Set<string>([
  operations.orderStart.id,
  operations.readingConfirm.id,
  operations.effectReconcile.id,
  operations.seatRequest.id,
]);
export const isAgent = (context: ExecutionContext) =>
  context.runId !== undefined || context.grant !== undefined;

/** Resolve the station an operation acts on from authoritative state, never from caller claims. */
function stationOf(state: LineState, operation: string, args: Record<string, unknown>) {
  if (operation === operations.stopClassify.id)
    return own(state.stops, String(args.stopId))?.station;
  if (operation === operations.readingConfirm.id)
    return own(state.attention, String(args.attentionId))?.station;
  return typeof args.station === 'string' ? args.station : undefined;
}

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

/**
 * Station-scoped policy. Roles come from authoritative state. Integration principals are
 * separate and narrow: a station bridge acts only for its own station, the MES integration only
 * on master data and MES outcomes, and neither can do what people do. Which target an
 * integration principal may settle is checked by the settle handler against the effect itself,
 * inside the same transaction. Commands are evaluated against current and proposed state.
 */
export const linePolicy: AuthorizationPort<LineState> = {
  authorize({ capability, input, context, state, previousState, phase }) {
    const operation = capability.id;
    if (!knownOperations.has(operation)) return { allowed: false, reason: 'NO_POLICY' };
    const args = input as Record<string, unknown>;
    const bridge = bridgeStation(state, context.principalId);
    if (bridge) {
      if (!bridgeOperations.has(operation)) return { allowed: false, reason: 'INTEGRATION_SCOPE' };
      // Its own station only; settle names no station and is checked against the effect.
      return {
        allowed: operation === operations.effectSettle.id || args.station === bridge.id,
        reason: 'INTEGRATION_SCOPE',
      };
    }
    if (context.principalId === state.mesPrincipalId)
      return { allowed: mesOperations.has(operation), reason: 'INTEGRATION_SCOPE' };
    if (bridgeOperations.has(operation) || operation === operations.mesSync.id)
      return { allowed: false, reason: 'INTEGRATION_ONLY' };
    if (personOnly.has(operation) && isAgent(context))
      return { allowed: false, reason: 'PERSON_AT_STATION' };
    if (scopedInHandler.has(operation)) return { allowed: true };
    // Reconcile names an effect; the handler resolves its station and checks the role there.
    if (operation === operations.effectReconcile.id) return { allowed: true };
    const evaluate = (snapshot: LineState): boolean => {
      const station = stationOf(snapshot, operation, args);
      if (station === undefined) return false;
      // A resource-limited delegation names stations; it cannot reach other stations.
      if (context.grant?.resources && !context.grant.resources.includes(`station:${station}`))
        return false;
      const role = stationRole(snapshot, context.principalId, station);
      if (!role) return false;
      if (capability.kind === 'query' || phase === 'replay') return true;
      if (operation === operations.bridgeSetMode.id || operation === operations.stationSetMember.id)
        return role === 'supervisor';
      return role === 'operator' || role === 'supervisor';
    };
    return {
      allowed: evaluate(state) && (!previousState || evaluate(previousState)),
      reason: 'RESOURCE_DENIED',
    };
  },
  canReadEvent({ state, context, event }) {
    if (context.principalId === state.mesPrincipalId) return true;
    const station = stationOfResource(state, event.resource);
    const bridge = bridgeStation(state, context.principalId);
    if (bridge) return station === bridge.id;
    // MES master-data changes are visible to anyone who works at some station.
    if (event.resource === 'mes:sync')
      return Object.keys(state.stations).some((id) => stationRole(state, context.principalId, id));
    return station !== undefined && stationRole(state, context.principalId, station) !== undefined;
  },
};
