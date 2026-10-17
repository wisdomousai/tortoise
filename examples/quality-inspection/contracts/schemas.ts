import { z } from 'zod';

export const id = z.string().min(1).max(128);
export const revision = z.number().int().min(0);
export const timestamp = z.number().int().min(0);
export const syncStatus = z.enum(['pending', 'accepted', 'rejected']);
export const rejection = z.strictObject({ code: z.string(), message: z.string() });
export const synchronized = {
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
export const captureSchema = z.strictObject({
  /** Derived by the authority: delegated runs and grants are agents, direct sessions humans. */
  actor: z.enum(['human', 'agent']),
  durationMs: z.number().int().min(0).optional(),
  input: captureTelemetrySchema.shape.input.optional(),
});
export const instrumentDeviceSchema = z.strictObject({
  driver: z.string().min(1).max(128),
  driverVersion: z.string().max(64).optional(),
  serial: z.string().max(128).optional(),
  firmware: z.string().max(128).optional(),
});
export const instrumentProvenanceSchema = z.strictObject({
  readingId: id,
  ...instrumentDeviceSchema.shape,
});
export const instrumentReadingSchema = z.strictObject({
  id,
  revision,
  value: z.number(),
  unit: z.string(),
  observedAt: timestamp,
  device: instrumentDeviceSchema,
  usedBy: id.optional(),
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
  instrument: instrumentProvenanceSchema.optional(),
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
export const nextSample = z.strictObject({ characteristicId: id, sample: z.number().int().min(1) });
export const lotSummaryShape = {
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
export const measurement = {
  characteristicId: id,
  sample: z.number().int().min(1).max(50).optional(),
  value: z.number().optional(),
  code: z.string().min(1).max(32).optional(),
  occurredAt: timestamp,
  capture: captureTelemetrySchema.optional(),
};
export const latency = z.strictObject({
  count: z.number().int(),
  medianMs: z.number().optional(),
  p90Ms: z.number().optional(),
});
export const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
