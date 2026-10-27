import { peerLane, targetLane, targetRules } from '@agent-native/integration';
import { definePolicy, membershipRule, own, type OperationRule } from '@agent-native/runtime';
import { operations, qualityTarget } from './contracts';
import { plantMembership } from './contracts/membership';
import { qualityPeerSurface } from './contracts/peer';
import { capturesAnywhere, plantRole, type PlantRole, type QualityState } from './domain';

/**
 * Resolve the lot that owns a journal or outbox resource (`lot:`, `result:`, `defect:`), or
 * undefined for resources no lot owns. Every lot-scoped visibility check goes through this one
 * mapping, so rows, counts and effect aggregates cannot disagree about ownership.
 */
export function lotOfResource(state: QualityState, resource: string): string | undefined {
  const separator = resource.indexOf(':');
  const type = resource.slice(0, separator);
  const id = resource.slice(separator + 1);
  return type === 'lot'
    ? id
    : type === 'result'
      ? own(state.results, id)?.lotId
      : type === 'defect'
        ? own(state.defects, id)?.lotId
        : undefined;
}

/** Resolve the plant that governs read access to a journal resource. */
export function plantOfResource(state: QualityState, resource: string): string | undefined {
  if (resource.startsWith('plant:')) {
    const id = resource.slice(6);
    return own(state.plants, id) ? id : undefined;
  }
  const lotId = lotOfResource(state, resource);
  return lotId === undefined ? undefined : own(state.lots, lotId)?.plant;
}

type Rule = OperationRule<QualityState, PlantRole>;
const plantOfLot = (state: QualityState, lotId: unknown) =>
  typeof lotId === 'string' ? own(state.lots, lotId)?.plant : undefined;
/** An operation on one lot: the lot's plant role decides, and a resource grant must name the lot. */
const onLot = (
  lotId: (input: Record<string, unknown>, state: QualityState) => unknown,
  roles?: PlantRole[],
): Rule => ({
  container: (input, state) => plantOfLot(state, lotId(input, state)),
  grant: (input, state) => {
    const id = lotId(input, state);
    return typeof id === 'string' ? `lot:${id}` : undefined;
  },
  ...(roles ? { roles } : {}),
});
const byLotId = (input: Record<string, unknown>) => input.lotId;
const byResult = (input: Record<string, unknown>, state: QualityState) =>
  own(state.results, String(input.resultId))?.lotId;
const capture: PlantRole[] = ['inspector', 'supervisor'];
/** Events of `<type>:<id>` follow the plant that owns the resource. */
const lotEvent = (type: string) => ({
  container: (id: string, state: QualityState) => plantOfResource(state, `${type}:${id}`),
});

/**
 * Plant-scoped policy. Plant roles come from authoritative state; the integration principal may
 * only sync master data, settle outbox outcomes and read its watermark, and nobody else may do
 * the first two. The instrument principal may only report readings, and nobody else may. A peer
 * application's service principal may only announce arrivals and read their outcomes; a peer
 * acting for a mapped person has that person's plant roles. Reads that list records are open to every caller and scoped to their plants in
 * the handler, before anything is counted. Commands are evaluated against the current and the
 * proposed state at commit time.
 */
export const qualityPolicy = definePolicy<QualityState, PlantRole>({
  roleOf: plantRole,
  integrations: [
    targetLane(qualityTarget, (state, principalId) => principalId === state.integrationPrincipalId),
    // The instrument driver only reports readings; it reads no journal events.
    {
      is: (state, principalId) => principalId === state.instrumentPrincipalId,
      operations: [operations.instrumentIngest.id],
      events: () => false,
    },
    // Peer applications, as their service principals: announce arrivals and read their feed.
    peerLane(qualityPeerSurface),
  ],
  operations: {
    ...targetRules(qualityTarget),
    [operations.lotList.id]: 'open',
    [operations.codeList.id]: 'open',
    [operations.plantList.id]: 'open',
    [operations.metricsSummary.id]: 'open',
    // Scoped in the handler to people who capture at some plant.
    [operations.instrumentReadings.id]: 'open',
    [operations.instrumentIngest.id]: 'integration',
    [operations.lotGet.id]: onLot((input) => input.id),
    [operations.worklist.id]: onLot(byLotId),
    [operations.resultRecord.id]: onLot(byLotId, capture),
    [operations.resultRecordBatch.id]: onLot(byLotId, capture),
    [operations.defectRecord.id]: onLot(byLotId, capture),
    [operations.decisionSet.id]: onLot(byLotId, ['supervisor']),
    // Supervisors correct any result at their plant; inspectors only their own.
    [operations.resultCorrect.id]: {
      ...onLot(byResult, ['inspector', 'supervisor']),
      allow: ({ role, state, input, context, kind, phase }) =>
        kind === 'query' ||
        phase === 'replay' ||
        role === 'supervisor' ||
        own(state.results, String(input.resultId))?.recordedBy === context.principalId,
    },
    [operations.plantSetMember.id]: membershipRule(plantMembership),
    [operations.arrivalAnnounce.id]: 'integration',
    [operations.arrivalFeed.id]: 'integration',
    // Scoped in the handler to people who capture at some plant.
    [operations.arrivalList.id]: 'open',
    [operations.arrivalGet.id]: 'open',
    [operations.arrivalClose.id]: {
      allow: ({ state, context }) => capturesAnywhere(state, context.principalId),
    },
  },
  events: {
    lot: lotEvent('lot'),
    result: lotEvent('result'),
    defect: lotEvent('defect'),
    plant: lotEvent('plant'),
    // Master-data sync changes are visible to anyone who works at some plant.
    // Readings belong to the station, not a lot: anyone who captures somewhere may see them.
    instrument: (_id, state, context) => capturesAnywhere(state, context.principalId),
    arrival: (_id, state, context) => capturesAnywhere(state, context.principalId),
    sync: (id, state, context) =>
      id === qualityTarget.target &&
      Object.keys(state.plants).some((plant) => plantRole(state, context.principalId, plant)),
  },
});
