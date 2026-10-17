import { own, put } from '@agent-native/runtime';

/**
 * Quality inspection capture on top of an external quality system of record (SoR).
 *
 * The SoR owns inspection lots, specifications and code catalogs; they arrive through the
 * integration principal's sync command. This application owns the capture working set: results,
 * defects and usage decisions recorded at the moment of inspection, each forwarded to the SoR
 * through the outbox. Records are append-only; a correction supersedes a result instead of
 * editing it, so the audit trail matches what the SoR received.
 */
export type PlantRole = 'inspector' | 'supervisor' | 'viewer';
export type SyncStatus = 'pending' | 'accepted' | 'rejected';
export type Valuation = 'accepted' | 'rejected';

export interface Characteristic {
  id: string;
  code: string;
  text: string;
  kind: 'quantitative' | 'qualitative';
  unit?: string;
  target?: number;
  lower?: number;
  upper?: number;
  decimals?: number;
  sampleSize: number;
  codeGroup?: string;
}
/** Lot identifiers are the SoR's inspection lot numbers. */
export interface InspectionLot {
  id: string;
  plant: string;
  material: string;
  materialText: string;
  batch?: string;
  quantity: number;
  unit: string;
  /** `closed` means the SoR closed the lot; capture stops even without a local decision. */
  status: 'open' | 'decided' | 'closed';
  characteristics: Characteristic[];
  decision?: UsageDecision;
}
/** Outbox bookkeeping shared by every record forwarded to the SoR. */
export interface Synchronized {
  effectId: string;
  sync: SyncStatus;
  sorRef?: string;
  rejection?: { code: string; message: string };
}
export interface InspectionResult extends Synchronized {
  id: string;
  lotId: string;
  characteristicId: string;
  sample: number;
  value?: number;
  code?: string;
  evaluation: Valuation;
  /** When the real-world measurement happened (client clock, bounded skew). */
  occurredAt: number;
  /** When the authority committed it (authority clock). */
  recordedAt: number;
  recordedBy: string;
  station?: string;
  supersedes?: string;
  supersededBy?: string;
  reason?: string;
  /** Capture telemetry; `actor` is derived by the authority, the rest is client-reported. */
  capture: {
    actor: 'human' | 'agent';
    durationMs?: number;
    input?: 'keyboard' | 'scanner' | 'instrument' | 'touch';
  };
}
export interface Defect extends Synchronized {
  id: string;
  lotId: string;
  characteristicId?: string;
  code: string;
  quantity: number;
  note?: string;
  recordedBy: string;
  recordedAt: number;
}
export interface UsageDecision extends Synchronized {
  code: 'accept' | 'reject' | 'conditional';
  note?: string;
  decidedBy: string;
  decidedAt: number;
}
export interface CodeGroup {
  id: string;
  codes: { code: string; text: string; valuation: Valuation }[];
}
export interface QualityState {
  /** The only principal allowed to sync master data and settle outbox effects. */
  integrationPrincipalId: string;
  plants: Record<string, { members: Record<string, PlantRole> }>;
  lots: Record<string, InspectionLot>;
  results: Record<string, InspectionResult>;
  defects: Record<string, Defect>;
  codeGroups: Record<string, CodeGroup>;
  /** SoR watermark of the last applied sync batch. */
  watermark?: string;
  lastSyncAt?: number;
}

export function createQualityState(
  options: { supervisorId?: string; integrationPrincipalId?: string; plants?: string[] } = {},
): QualityState {
  const plants: QualityState['plants'] = {};
  for (const plant of options.plants ?? ['P100'])
    plants[plant] = { members: { [options.supervisorId ?? 'owner']: 'supervisor' } };
  return {
    integrationPrincipalId: options.integrationPrincipalId ?? 'integration',
    plants,
    lots: {},
    results: {},
    defects: {},
    codeGroups: {},
  };
}

/** Prototype-safe record access; keys are untrusted input. */
export { own, put };

export function plantRole(
  state: QualityState,
  principalId: string,
  plant: string,
): PlantRole | undefined {
  const entry = own(state.plants, plant);
  return entry ? own(entry.members, principalId) : undefined;
}

/** Results that have not been superseded by a correction. */
export function activeResults(state: QualityState, lotId: string): InspectionResult[] {
  return Object.values(state.results).filter(
    (result) => result.lotId === lotId && result.supersededBy === undefined,
  );
}

/** Evaluate a captured value against the specification valid at recording time. */
export function evaluate(
  state: QualityState,
  characteristic: Characteristic,
  value: { value?: number; code?: string },
): Valuation {
  if (characteristic.kind === 'quantitative')
    return (characteristic.lower === undefined || value.value! >= characteristic.lower) &&
      (characteristic.upper === undefined || value.value! <= characteristic.upper)
      ? 'accepted'
      : 'rejected';
  const group = own(state.codeGroups, characteristic.codeGroup ?? '');
  return group?.codes.find((code) => code.code === value.code)?.valuation ?? 'rejected';
}

/** Nearest-rank percentile over unsorted samples; undefined when there are none. */
export function percentile(values: readonly number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

/** Capture progress and the next open sample, which drives the capture loop and agent worklist. */
export function progress(state: QualityState, lot: InspectionLot) {
  const results = activeResults(state, lot.id);
  let next: { characteristicId: string; sample: number } | null = null;
  let recorded = 0;
  let required = 0;
  for (const characteristic of lot.characteristics) {
    required += characteristic.sampleSize;
    // Only required slots count: a sample plan reduced after capture leaves results beyond
    // `sampleSize` on record, but they cannot complete the slots the plan still requires.
    const samples = new Set(
      results
        .filter(
          (result) =>
            result.characteristicId === characteristic.id &&
            result.sample <= characteristic.sampleSize,
        )
        .map((result) => result.sample),
    );
    recorded += samples.size;
    if (!next)
      for (let sample = 1; sample <= characteristic.sampleSize; sample++)
        if (!samples.has(sample)) {
          next = { characteristicId: characteristic.id, sample };
          break;
        }
  }
  const synchronized: Synchronized[] = [
    ...results,
    ...Object.values(state.defects).filter((defect) => defect.lotId === lot.id),
    ...(lot.decision ? [lot.decision] : []),
  ];
  return {
    recorded,
    required,
    outOfTolerance: results.filter((result) => result.evaluation === 'rejected').length,
    pendingSync: synchronized.filter((record) => record.sync === 'pending').length,
    rejectedSync: synchronized.filter((record) => record.sync === 'rejected').length,
    next: lot.status === 'open' ? next : null,
  };
}
