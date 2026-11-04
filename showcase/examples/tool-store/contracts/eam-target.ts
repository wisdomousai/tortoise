import { z } from 'zod';
import { defineTarget } from '@tortoise/contracts';
import { toolSchema } from './tool';

/** The outbox effect type a damaged return enqueues for the EAM. */
export const repairOrderEffect = 'repair-order.create';

/** What the repair order effect sends to the EAM. */
export type RepairOrderPayload = {
  assetTag: string;
  /** The attendant's note on return, when they wrote one. */
  note?: string;
  /** The attendant who took the tool back. */
  returnedBy: string;
};

/**
 * One store tool in the EAM's inbound: the master data the EAM owns, keyed by asset tag. The inbound sync
 * names no status, because the store decides where a tool stands.
 */
export const eamToolSchema = z.strictObject({
  assetTag: toolSchema.shape.assetTag,
  description: toolSchema.shape.description,
  category: toolSchema.shape.category,
  bin: toolSchema.shape.bin,
  calibrationDue: toolSchema.shape.calibrationDue.describe(
    'The date calibration is due, as YYYY-MM-DD. Absent when the EAM plans no calibration for the tool.',
  ),
  version: z
    .number()
    .int()
    .nonnegative()
    .describe("The EAM's change number of this asset. A higher number is a newer version."),
});
export type EamTool = z.output<typeof eamToolSchema>;

/**
 * The plant EAM as a system of record. It owns the tool master data and the repair orders: a
 * damaged return sends it a repair order, and its inbound sync updates the description, category, bin and
 * calibration date of the tools the store holds.
 */
// #region target
export const eamTarget = defineTarget({
  target: 'eam',
  resourceType: 'EamSync',
  changes: ['loan'],
  inbound: { item: eamToolSchema, max: 100, changes: ['tool'] },
  status: {
    pending: z.number().int().describe('Repair orders waiting for the EAM, held ones included.'),
    held: z
      .number()
      .int()
      .describe('Repair orders whose outcome nobody could establish, waiting for a person.'),
    accepted: z.number().int().describe('Repair orders the EAM opened.'),
    rejected: z.number().int().describe('Repair orders the EAM refused.'),
  },
  descriptions: {
    complete:
      'Integration principal only: record the EAM outcome for the repair order of a damaged return.',
    sync: 'Integration principal only: apply tool master data from the EAM inbound sync and advance the watermark. A stale from watermark conflicts, and an item no newer than the applied version of its asset tag is dropped.',
    status:
      'Summarize repair orders sent to the EAM: waiting, held for a person, accepted and rejected, and the last inbound sync.',
  },
});
// #endregion target
