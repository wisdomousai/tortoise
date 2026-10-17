import { z } from 'zod';

export const id = z.string().min(1).max(128);
export const revision = z.number().int().min(0);
export const timestamp = z.number().int().min(0);
export const stationRoleSchema = z.enum(['operator', 'supervisor', 'viewer']);
export const bridgeModeSchema = z.enum(['monitor-only', 'assist', 'actuate']);
export const seatSchema = z.enum(['operator', 'agent', 'idle']);
/** `held`: a screen procedure was interrupted and a person must say whether it took effect. */
export const syncSchema = z.enum(['pending', 'held', 'accepted', 'rejected']);
const rejection = z.strictObject({ code: z.string(), message: z.string() });
const fieldValue = z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]);
const model = z.strictObject({
  id: z.string().max(200),
  version: z.string().max(100).optional(),
  digest: z.string().max(200).optional(),
});

/** One reading as the bridge submits it (see `Observation` in @agent-native/station). */
const fieldDeclaration = z.strictObject({
  type: z.enum(['number', 'text', 'enum', 'boolean']),
  options: z.array(z.string().max(100)).max(100).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  unit: z.string().max(16).optional(),
});
const profileIdentity = z.strictObject({ id: z.string().max(64), version: z.string().max(32) });
export const observedReadingSchema = z.strictObject({
  field: z.string().min(1).max(64),
  value: fieldValue,
  confidence: z.number().min(0).max(1),
  extractor: z.string().min(1).max(64),
  model: model.optional(),
  observedAt: timestamp,
  frameDigest: z.string().min(1).max(128),
  status: z.enum(['observed', 'uncertain']),
  minConfidence: z.number().min(0).max(1),
  /** The profile's field declaration; without it the type is inferred from the value. */
  declared: fieldDeclaration.optional(),
});
export const observationSchema = z.strictObject({
  station: id,
  profile: profileIdentity,
  screen: z.string().max(64).nullable(),
  observedAt: timestamp,
  frameDigest: z.string().min(1).max(128),
  localInput: z.boolean(),
  readings: z.array(observedReadingSchema).max(100),
});
/** A field value as recorded, with the provenance a reader needs to judge it. */
export const readingSchema = z.strictObject({
  value: fieldValue,
  confidence: z.number(),
  /** Extractor id, or `operator` for a person's confirmation. */
  source: z.string(),
  model: model.optional(),
  observedAt: timestamp,
  /** Frame and profile that produced an observed value, so it can be explained afterwards. */
  frameDigest: z.string().optional(),
  profile: profileIdentity.optional(),
  status: z.enum(['observed', 'operator-verified']),
  verifiedBy: id.optional(),
  stale: z.boolean(),
});
export const stopSchema = z.strictObject({
  id,
  revision,
  station: id,
  orderId: id.optional(),
  state: z.enum(['STOPPED', 'ALARM']),
  alarm: z.string().optional(),
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  reason: z.string().optional(),
  classifiedBy: id.optional(),
  classifiedAt: timestamp.optional(),
  sync: syncSchema.optional(),
  sorRef: z.string().optional(),
  rejection: rejection.optional(),
});
export const countReportSchema = z.strictObject({
  id,
  station: id,
  orderId: id,
  good: z.number(),
  scrap: z.number(),
  observedAt: timestamp,
  provenance: z.enum(['observed', 'operator-verified']),
  confirmedBy: id,
  confirmedAt: timestamp,
  sync: syncSchema,
  sorRef: z.string().optional(),
  rejection: rejection.optional(),
});
export const attentionSchema = z.strictObject({
  id,
  station: id,
  kind: z.enum(['reading', 'reconcile']),
  title: z.string(),
  detail: z.string().optional(),
  field: z.string().optional(),
  proposed: fieldValue.optional(),
  /** How a correction must be entered: the field's declared type, options and format. */
  value: fieldDeclaration.optional(),
  confidence: z.number().optional(),
  source: z.string().optional(),
  frameDigest: z.string().optional(),
  profile: profileIdentity.optional(),
  effectId: id.optional(),
  createdAt: timestamp,
});
export const orderSchema = z.strictObject({
  id,
  station: id,
  material: z.string().max(64),
  materialText: z.string().max(200),
  recipe: z.string().max(64),
  quantity: z.number().min(0),
  status: z.enum(['released', 'active', 'completed']),
});
/** An MES order as its feed delivers it: `closed` instead of the local status. */
export const orderSnapshotSchema = orderSchema
  .omit({ status: true })
  .extend({ closed: z.boolean() });
export const reasonSchema = z.strictObject({
  code: z.string().min(1).max(32),
  text: z.string().max(200),
  category: z.enum(['planned', 'unplanned', 'quality']),
});
export const desiredSchema = z.strictObject({
  recipe: z.string(),
  orderId: id,
  requestedBy: id,
  requestedAt: timestamp,
  sync: syncSchema,
  /** The station shows the desired recipe (confident readback). */
  converged: z.boolean(),
  holdReason: z.string().optional(),
  rejection: rejection.optional(),
});
const bridgeSchema = z.strictObject({
  mode: bridgeModeSchema,
  seat: seatSchema,
  seatChangedBy: id.optional(),
  seatChangedAt: timestamp.optional(),
  screen: z.string().nullable().optional(),
  observedAt: timestamp.optional(),
  profile: z.strictObject({ id: z.string(), version: z.string() }).optional(),
  localInputAt: timestamp.optional(),
  /** No observation within the freshness window: everything shown may be outdated. */
  stale: z.boolean(),
});
const stationSummaryShape = {
  id,
  revision,
  name: z.string(),
  line: z.string(),
  role: stationRoleSchema,
  machine: z.string().optional(),
  openStop: z.boolean(),
  attention: z.number().int(),
  mode: bridgeModeSchema,
  seat: seatSchema,
  stale: z.boolean(),
};
export const stationSummarySchema = z.strictObject(stationSummaryShape);
export const stationDetailSchema = z.strictObject({
  ...stationSummaryShape,
  /** Revision of the good/scrap counters; pass as counters:<id> when confirming counts. */
  countersRevision: revision,
  bridge: bridgeSchema,
  readings: z.record(z.string(), readingSchema),
  order: orderSchema.optional(),
  desired: desiredSchema.optional(),
  currentStop: stopSchema.optional(),
});
export const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
export const station = z.strictObject({ station: id });
