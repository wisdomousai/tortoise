import { z } from 'zod';
import { defineTarget } from '@agent-native/contracts';
import { operation } from './operation';
import {
  attributeName,
  captureSchema,
  extractionSchema,
  nodeSchema,
  photoLimits,
  proposedFieldSchema,
  recordId,
  text,
} from './schemas';

/** A proposal the extractor returns for one requested capture. */
export const proposalSchema = z.strictObject({
  captureId: recordId,
  /** The request this answers; a proposal for an older request is ignored. */
  effectId: z.string().min(1).max(128),
  model: z.string().max(120),
  fields: z.array(proposedFieldSchema).max(40),
});

/**
 * The extraction model as a target: requests go out through the outbox with the capture's
 * photos, and proposals come back through its feed. A proposal is data for review; nothing is
 * written to the structure until a person accepts it.
 */
export const modelTarget = defineTarget({
  target: 'model',
  resourceType: 'Extraction',
  operations: { settle: 'extraction.settle', sync: 'extraction.sync', status: 'extraction.status' },
  settles: ['extraction'],
  feed: { item: proposalSchema, max: 50, changes: ['extraction'] },
  status: {
    requested: z.number().int(),
    proposed: z.number().int(),
    attention: z.number().int(),
  },
  descriptions: {
    settle: 'Integration principal only: record whether the extractor took a request.',
    sync: 'Integration principal only: apply extraction proposals and advance the watermark.',
    status:
      'Extraction progress: requests waiting for the model, proposals waiting for review, and proposals with at least one low-confidence value.',
  },
});

/** Values below this confidence are flagged for attention. */
export const ATTENTION_BELOW = 0.8;

export const extractionOperations = {
  request: operation('extraction.request', 'command', {
    input: z.strictObject({ captureId: recordId }),
    output: extractionSchema,
    permission: { action: 'review', resourceType: 'Capture' },
    description:
      'Ask the extraction model to read a capture: nameplate values such as manufacturer, type, serial, year and ratings. The answer arrives later as a proposal on capture.get. Requesting again replaces an open proposal.',
    dependencies: ['extraction'],
    forwards: 'model',
    // The capture's photos are attached to the request so the connector may read them.
    blobs: photoLimits,
  }),
  accept: operation('extraction.accept', 'command', {
    input: z.strictObject({
      captureId: recordId,
      /** The values to keep, edited where the proposal was wrong; names absent are dropped. */
      values: z.record(attributeName, text(200)),
    }),
    output: nodeSchema,
    permission: { action: 'review', resourceType: 'Capture' },
    description:
      'Accept a proposal for a placed capture: write the given values as attributes of its node, each recording the capture and whether it was edited. Check every value flagged attention against the photo first. The capture is then reviewed.',
    dependencies: ['extraction', 'capture', 'node'],
  }),
  placeAndExtract: operation('capture.place-and-extract', 'command', {
    input: z.strictObject({ id: recordId, nodeId: recordId }),
    output: z.strictObject({ capture: captureSchema, extraction: extractionSchema }),
    permission: { action: 'review', resourceType: 'Capture' },
    description:
      'Place a capture on a node and ask the extraction model to read it, in one step: both happen or neither does. Refused as a whole when either one would be.',
    dependencies: ['capture', 'extraction'],
    invokes: ['capture.place', 'extraction.request'],
  }),
  status: modelTarget.status,
  sync: modelTarget.sync,
  settle: modelTarget.settle,
} as const;
