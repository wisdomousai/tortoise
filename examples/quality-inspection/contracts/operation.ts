import type { z } from 'zod';
import { defineCapability, jsonSchema } from '@agent-native/contracts';

const descriptions: Readonly<Record<string, string>> = {
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

/** Define one operation with its catalog description and UI binding or exception. */
export function operation<
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
