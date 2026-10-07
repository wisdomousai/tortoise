import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

const id = z.string().min(1).max(128);
const revision = z.number().int().min(0);
const timestamp = z.number().int().min(0);
const syncStatus = z.enum(['pending', 'accepted', 'rejected']);
const rejection = z.strictObject({ code: z.string(), message: z.string() });
const synchronized = {
  sync: syncStatus,
  sorRef: z.string().optional(),
  rejection: rejection.optional(),
};
/**
 * Capture telemetry supplied by the client with a datapoint. It measures the economics of the
 * capture interface (seconds from "ready" to commit) and never influences authorization.
 */
export const captureTelemetrySchema = z.strictObject({
  durationMs: z.number().int().min(0).max(3_600_000),
  input: z.enum(['keyboard', 'scanner', 'instrument', 'touch']),
});
const captureSchema = z.strictObject({
  /** Derived by the authority: delegated runs and grants are agents, direct sessions humans. */
  actor: z.enum(['human', 'agent']),
  durationMs: z.number().int().min(0).optional(),
  input: captureTelemetrySchema.shape.input.optional(),
});
export const plantRoleSchema = z.enum(['inspector', 'supervisor', 'viewer']);
export const characteristicSchema = z.strictObject({
  id,
  code: z.string().min(1).max(64),
  text: z.string().max(200),
  kind: z.enum(['quantitative', 'qualitative']),
  unit: z.string().max(16).optional(),
  target: z.number().optional(),
  lower: z.number().optional(),
  upper: z.number().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  sampleSize: z.number().int().min(1).max(50),
  codeGroup: id.optional(),
});
export const resultSchema = z.strictObject({
  id,
  revision,
  lotId: id,
  characteristicId: id,
  sample: z.number().int().min(1),
  value: z.number().optional(),
  code: z.string().optional(),
  evaluation: z.enum(['accepted', 'rejected']),
  occurredAt: timestamp,
  recordedAt: timestamp,
  recordedBy: id,
  station: z.string().optional(),
  supersedes: id.optional(),
  supersededBy: id.optional(),
  reason: z.string().optional(),
  capture: captureSchema,
  ...synchronized,
});
export const defectSchema = z.strictObject({
  id,
  revision,
  lotId: id,
  characteristicId: id.optional(),
  code: z.string(),
  quantity: z.number().int().min(1),
  note: z.string().optional(),
  recordedBy: id,
  recordedAt: timestamp,
  ...synchronized,
});
export const decisionSchema = z.strictObject({
  code: z.enum(['accept', 'reject', 'conditional']),
  note: z.string().optional(),
  decidedBy: id,
  decidedAt: timestamp,
  ...synchronized,
});
const nextSample = z.strictObject({ characteristicId: id, sample: z.number().int().min(1) });
const lotSummaryShape = {
  id,
  revision,
  plant: id,
  material: z.string(),
  materialText: z.string(),
  batch: z.string().optional(),
  quantity: z.number(),
  unit: z.string(),
  status: z.enum(['open', 'decided', 'closed']),
  recorded: z.number().int(),
  required: z.number().int(),
  outOfTolerance: z.number().int(),
  pendingSync: z.number().int(),
  rejectedSync: z.number().int(),
};
export const lotSummarySchema = z.strictObject(lotSummaryShape);
export const lotDetailSchema = z.strictObject({
  ...lotSummaryShape,
  characteristics: z.array(
    z.strictObject({ ...characteristicSchema.shape, results: z.array(resultSchema) }),
  ),
  defects: z.array(defectSchema),
  decision: decisionSchema.optional(),
  next: nextSample.nullable(),
});
export const codeGroupSchema = z.strictObject({
  id,
  codes: z
    .array(
      z.strictObject({
        code: z.string().min(1).max(32),
        text: z.string().max(200),
        valuation: z.enum(['accepted', 'rejected']),
      }),
    )
    .max(200),
});
/** A lot as published by the SoR. `closed` stops capture even without a local decision. */
export const lotSnapshotSchema = z.strictObject({
  id,
  plant: id,
  material: z.string().max(64),
  materialText: z.string().max(200),
  batch: z.string().max(64).optional(),
  quantity: z.number().min(0),
  unit: z.string().max(16),
  characteristics: z.array(characteristicSchema).min(1).max(50),
  closed: z.boolean(),
});
const measurement = {
  characteristicId: id,
  sample: z.number().int().min(1).max(50).optional(),
  value: z.number().optional(),
  code: z.string().min(1).max(32).optional(),
  occurredAt: timestamp,
  capture: captureTelemetrySchema.optional(),
};
export const outcomeSchema = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().max(256).optional() }),
  z.strictObject({
    status: z.literal('rejected'),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2000),
  }),
]);
const latency = z.strictObject({
  count: z.number().int(),
  medianMs: z.number().optional(),
  p90Ms: z.number().optional(),
});
const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

const descriptions: Readonly<Record<string, string>> = {
  'inspection.lot.list':
    'List inspection lots at plants where you hold a role, with capture progress and synchronization counts. Authorization precedes filtering, counting and pagination.',
  'inspection.lot.get':
    'Read one inspection lot with its characteristics, specification limits, active results, defects, usage decision and the next open sample. Use its revision as lot:<id> in a decision expectedRevisions map.',
  'inspection.worklist':
    'Return the next characteristic and sample to measure for an open lot, and how many samples remain. Call it after each recorded result to drive capture.',
  'inspection.code.list':
    'List qualitative code groups and defect codes published by the quality system, with their valuation.',
  'inspection.plant.list':
    'List plants where you hold a role. Supervisors also see the plant membership.',
  'inspection.sync.status':
    'Summarize synchronization with the quality system for your plants: pending, accepted and rejected records, the oldest pending item, recent rejections and the last master-data sync.',
  'inspection.metrics.summary':
    'Summarize capture economics for your plants: datapoints captured by humans and by agents with median and 90th-percentile milliseconds from ready to commit, corrections, out-of-tolerance results, and how long the quality system took to accept forwarded records.',
  'inspection.result.record':
    'Record one measured value (quantitative) or code (qualitative) for a characteristic sample of an open lot as inspector or supervisor. occurredAt is when the measurement happened (epoch ms, at most 24 h old). Omit sample to use the next open one. The receipt proves the local commit; the quality system accepts or rejects it later.',
  'inspection.result.record-batch':
    'Record up to 100 measurements for one open lot in a single commit, for example from an instrument export. All succeed or none do. Each result is forwarded to the quality system separately.',
  'inspection.result.correct':
    'Supersede a result with a corrected value or code and a reason. Supervisors may correct any result at their plant; inspectors only their own. The original is retained for audit. Use this to resolve a quality-system rejection.',
  'inspection.defect.record':
    'Record a defect with a catalog code and quantity for an open lot as inspector or supervisor.',
  'inspection.decision.set':
    'Set the usage decision for a fully inspected open lot as supervisor. Supply lot:<id> in expectedRevisions so results recorded after you reviewed the lot cause a conflict instead of being ignored.',
  'inspection.plant.set-member':
    'Grant or remove a plant role as supervisor of that plant. A null role removes access. You cannot change your own role. Permission changes invalidate affected views.',
  'inspection.lot.sync':
    'Integration principal only: apply a batch of lots and code groups from the quality system and advance the watermark. A stale from watermark conflicts.',
  'inspection.effect.settle':
    'Integration principal only: record the quality system outcome for a forwarded result, defect or decision.',
};

function operation<
  const Id extends string,
  const Kind extends 'command' | 'query',
  I extends z.ZodType,
  O extends z.ZodType,
>(
  name: Id,
  kind: Kind,
  input: I,
  output: O,
  permission: { action: string; resourceType: string },
  options: {
    dependencies: readonly string[];
    integration?: boolean;
    exception?: string;
  },
) {
  const description = descriptions[name];
  if (!description) throw new Error(`Missing operation description: ${name}`);
  return defineCapability({
    id: name,
    kind,
    description,
    input: jsonSchema(input),
    output: jsonSchema(output),
    permission,
    dependencies: options.dependencies,
    ui: options.exception ? { exception: options.exception } : { binding: name },
    ...(options.integration
      ? { integration: { target: 'quality-system', delivery: 'outbox' as const } }
      : {}),
  });
}

const lotRead = { action: 'read', resourceType: 'InspectionLot' };
const capture = { action: 'capture', resourceType: 'InspectionLot' };
export const operations = {
  lotList: operation(
    'inspection.lot.list',
    'query',
    z.strictObject({
      ...page,
      plant: id.optional(),
      status: z.enum(['open', 'decided', 'closed']).optional(),
      search: z.string().max(100).optional(),
    }),
    z.strictObject({ items: z.array(lotSummarySchema), count: z.number().int() }),
    lotRead,
    { dependencies: ['lot', 'result', 'defect', 'plant'] },
  ),
  lotGet: operation(
    'inspection.lot.get',
    'query',
    z.strictObject({ id }),
    lotDetailSchema,
    lotRead,
    {
      dependencies: ['lot', 'result', 'defect', 'sync'],
    },
  ),
  worklist: operation(
    'inspection.worklist',
    'query',
    z.strictObject({ lotId: id }),
    z.strictObject({ lotId: id, next: nextSample.nullable(), remaining: z.number().int() }),
    lotRead,
    { dependencies: ['lot', 'result'] },
  ),
  codeList: operation(
    'inspection.code.list',
    'query',
    z.strictObject({}),
    z.strictObject({ groups: z.array(codeGroupSchema) }),
    { action: 'read', resourceType: 'CodeGroup' },
    { dependencies: ['sync'] },
  ),
  plantList: operation(
    'inspection.plant.list',
    'query',
    z.strictObject({}),
    z.strictObject({
      items: z.array(
        z.strictObject({
          plant: id,
          role: plantRoleSchema,
          members: z.record(z.string(), plantRoleSchema).optional(),
        }),
      ),
    }),
    { action: 'read', resourceType: 'Plant' },
    { dependencies: ['plant'] },
  ),
  syncStatus: operation(
    'inspection.sync.status',
    'query',
    z.strictObject({}),
    z.strictObject({
      watermark: z.string().optional(),
      lastSyncAt: timestamp.optional(),
      pending: z.number().int(),
      accepted: z.number().int(),
      rejected: z.number().int(),
      retrying: z.number().int(),
      oldestPendingAt: timestamp.optional(),
      rejections: z.array(
        z.strictObject({ resource: z.string(), lotId: id, code: z.string(), message: z.string() }),
      ),
    }),
    { action: 'read', resourceType: 'Synchronization' },
    { dependencies: ['lot', 'result', 'defect', 'sync'] },
  ),
  metricsSummary: operation(
    'inspection.metrics.summary',
    'query',
    z.strictObject({ plant: id.optional(), since: timestamp.optional() }),
    z.strictObject({
      datapoints: z.number().int(),
      human: latency,
      agent: latency,
      corrections: z.number().int(),
      outOfTolerance: z.number().int(),
      forwarding: z.strictObject({
        pending: z.number().int(),
        rejected: z.number().int(),
        accepted: latency,
      }),
    }),
    { action: 'read', resourceType: 'CaptureMetrics' },
    { dependencies: ['result', 'sync'] },
  ),
  resultRecord: operation(
    'inspection.result.record',
    'command',
    z.strictObject({ lotId: id, station: z.string().max(64).optional(), ...measurement }),
    resultSchema,
    capture,
    { dependencies: ['lot', 'result'], integration: true },
  ),
  resultRecordBatch: operation(
    'inspection.result.record-batch',
    'command',
    z.strictObject({
      lotId: id,
      station: z.string().max(64).optional(),
      results: z.array(z.strictObject(measurement)).min(1).max(100),
    }),
    z.strictObject({ items: z.array(resultSchema) }),
    capture,
    { dependencies: ['lot', 'result'], integration: true },
  ),
  resultCorrect: operation(
    'inspection.result.correct',
    'command',
    z.strictObject({
      resultId: id,
      value: z.number().optional(),
      code: z.string().min(1).max(32).optional(),
      occurredAt: timestamp.optional(),
      reason: z.string().min(1).max(500),
    }),
    resultSchema,
    { action: 'correct', resourceType: 'InspectionResult' },
    { dependencies: ['lot', 'result'], integration: true },
  ),
  defectRecord: operation(
    'inspection.defect.record',
    'command',
    z.strictObject({
      lotId: id,
      characteristicId: id.optional(),
      code: z.string().min(1).max(32),
      quantity: z.number().int().min(1).max(1_000_000),
      note: z.string().max(1000).optional(),
    }),
    defectSchema,
    capture,
    { dependencies: ['lot', 'defect'], integration: true },
  ),
  decisionSet: operation(
    'inspection.decision.set',
    'command',
    z.strictObject({
      lotId: id,
      code: z.enum(['accept', 'reject', 'conditional']),
      note: z.string().max(1000).optional(),
    }),
    z.strictObject({ lotId: id, revision, decision: decisionSchema }),
    { action: 'decide', resourceType: 'InspectionLot' },
    { dependencies: ['lot'], integration: true },
  ),
  plantSetMember: operation(
    'inspection.plant.set-member',
    'command',
    z.strictObject({ plant: id, principalId: id, role: plantRoleSchema.nullable() }),
    z.strictObject({ plant: id, members: z.record(z.string(), plantRoleSchema) }),
    { action: 'administer', resourceType: 'Plant' },
    { dependencies: ['plant'] },
  ),
  lotSync: operation(
    'inspection.lot.sync',
    'command',
    z.strictObject({
      from: z.string().max(256).optional(),
      to: z.string().min(1).max(256),
      lots: z.array(lotSnapshotSchema).max(200),
      codeGroups: z.array(codeGroupSchema).max(100).optional(),
    }),
    z.strictObject({ watermark: z.string(), lots: z.number().int() }),
    { action: 'sync', resourceType: 'InspectionLot' },
    { dependencies: ['lot', 'sync'], exception: 'integration principal (inbound sync job)' },
  ),
  effectSettle: operation(
    'inspection.effect.settle',
    'command',
    z.strictObject({ effectId: id, outcome: outcomeSchema }),
    z.strictObject({ resource: z.string(), sync: syncStatus }),
    { action: 'settle', resourceType: 'Synchronization' },
    {
      dependencies: ['lot', 'result', 'defect'],
      exception: 'integration principal (outbox dispatcher)',
    },
  ),
} as const;

export const qualityInspectionModule = defineModule({
  id: 'quality-inspection',
  capabilities: Object.values(operations),
  requirements: {
    network: [
      {
        id: 'quality-system-api',
        purpose:
          'Forward results, defects and usage decisions to the quality system and pull lots and characteristics from it.',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['quality-system'],
        dataClasses: ['inspection-result', 'defect', 'usage-decision'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
  workflows: [
    {
      id: 'inspect-lot',
      operations: [
        'inspection.lot.list',
        'inspection.worklist',
        'inspection.lot.get',
        'inspection.result.record-batch',
        'inspection.result.record',
        'inspection.defect.record',
      ],
      text: 'Find the open lot, read its characteristics and limits, then record each measurement for the sample named by the worklist. For an instrument export, map rows to characteristics and samples and submit them with record-batch in one commit; never invent values that are not in the source. Use the measurement time from the source as occurredAt. Report out-of-tolerance results and record a defect only when the source states one. Leave the usage decision to a supervisor.',
    },
    {
      id: 'triage-rejections',
      operations: ['inspection.sync.status', 'inspection.lot.get', 'inspection.result.correct'],
      text: 'Read rejected records from sync status, inspect the lot and the rejection reason, and explain each one. Correct a result only when the reason identifies a clear entry error and the correct value is known; supply that reason. Otherwise ask the user. A correction is forwarded again and may itself be rejected.',
    },
  ],
});
