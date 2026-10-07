import type { AuthorizationPort } from '@agent-native/runtime';
import { operations } from './contracts';
import { own, plantRole, type QualityState } from './domain';

const knownOperations = new Set<string>(Object.values(operations).map((operation) => operation.id));
const integrationOnly = new Set<string>([operations.lotSync.id, operations.effectSettle.id]);
/** Handlers scope these to the caller's plants before filtering, counting and pagination. */
const scopedInHandler = new Set<string>([
  operations.lotList.id,
  operations.codeList.id,
  operations.plantList.id,
  operations.syncStatus.id,
  operations.metricsSummary.id,
]);

/** Resolve the lot an operation acts on from authoritative state, never from caller claims. */
function lotIdOf(state: QualityState, operation: string, args: Record<string, unknown>) {
  if (operation === operations.lotGet.id) return String(args.id);
  if (operation === operations.resultCorrect.id)
    return own(state.results, String(args.resultId))?.lotId;
  return typeof args.lotId === 'string' ? args.lotId : undefined;
}

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

/**
 * Plant-scoped policy. Plant roles come from authoritative state; the integration principal may
 * only sync master data and settle outbox outcomes, and nobody else may do either. Commands are
 * evaluated against both the current and the proposed state at commit time.
 */
export const qualityPolicy: AuthorizationPort<QualityState> = {
  authorize({ capability, input, context, state, previousState, phase }) {
    const operation = capability.id;
    if (!knownOperations.has(operation)) return { allowed: false, reason: 'NO_POLICY' };
    const integration = context.principalId === state.integrationPrincipalId;
    if (integrationOnly.has(operation)) return { allowed: integration, reason: 'INTEGRATION_ONLY' };
    // Inbound sync reads its watermark here; plant-scoped counts are empty for this principal.
    if (integration && operation === operations.syncStatus.id) return { allowed: true };
    if (integration) return { allowed: false, reason: 'INTEGRATION_SCOPE' };
    if (scopedInHandler.has(operation)) return { allowed: true };
    const args = input as Record<string, unknown>;
    const evaluate = (snapshot: QualityState): boolean => {
      let plant: string | undefined;
      if (operation === operations.plantSetMember.id) plant = String(args.plant);
      else {
        const lotId = lotIdOf(snapshot, operation, args);
        if (lotId === undefined) return false;
        // A resource-limited delegation names lots; it cannot reach other lots' records.
        if (context.grant?.resources && !context.grant.resources.includes(`lot:${lotId}`))
          return false;
        plant = own(snapshot.lots, lotId)?.plant;
      }
      const role =
        plant === undefined ? undefined : plantRole(snapshot, context.principalId, plant);
      if (!role) return false;
      if (capability.kind === 'query' || phase === 'replay') return true;
      switch (operation) {
        case operations.resultRecord.id:
        case operations.resultRecordBatch.id:
        case operations.defectRecord.id:
          return role !== 'viewer';
        case operations.resultCorrect.id:
          return (
            role === 'supervisor' ||
            (role === 'inspector' &&
              own(snapshot.results, String(args.resultId))?.recordedBy === context.principalId)
          );
        case operations.decisionSet.id:
        case operations.plantSetMember.id:
          return role === 'supervisor';
        default:
          return false;
      }
    };
    return {
      allowed: evaluate(state) && (!previousState || evaluate(previousState)),
      reason: 'RESOURCE_DENIED',
    };
  },
  canReadEvent({ state, context, event }) {
    if (context.principalId === state.integrationPrincipalId) return true;
    // Master-data sync changes are visible to anyone who works at some plant.
    if (event.resource === 'sync:quality')
      return Object.keys(state.plants).some((plant) =>
        plantRole(state, context.principalId, plant),
      );
    const plant = plantOfResource(state, event.resource);
    return plant !== undefined && plantRole(state, context.principalId, plant) !== undefined;
  },
};
