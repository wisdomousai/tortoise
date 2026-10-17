import { z } from 'zod';
import { blobRefSchema, deliveryShape } from '@agent-native/contracts';
import { schemeIds } from './schemes';

export const recordId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
export const timestamp = z.number().int().nonnegative();
export const scheme = z.enum(schemeIds);
/** Stored as given, so it may not start or end with white space; contracts allow no transforms. */
export const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^\S(?:[\s\S]*\S)?$/);
/** Normalized by the handler: trimmed, upper case, single spaces. */
export const designation = z.string().min(1).max(64);
export const captureKind = z.enum(['nameplate', 'overview', 'label', 'defect', 'schematic']);
export const condition = z.enum(['good', 'fair', 'poor', 'failed']);
/** `proposed` nodes came from a document or an agent and wait for a manager to accept them. */
export const nodeSource = z.enum(['manual', 'proposed', 'accepted']);
/** Attribute names are camelCase words, such as `manufacturer` or `ratedVoltage`. */
export const attributeName = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][A-Za-z0-9]*$/);

/** One attribute of a node: its value and the capture it was read from. */
export const attributeSchema = z.strictObject({
  value: z.string().max(200),
  captureId: z.string().optional(),
  /** The reviewer changed the value the extraction proposed. */
  edited: z.boolean(),
});

export const nodeSchema = z.strictObject({
  id: recordId,
  parentId: recordId.optional(),
  scheme,
  designation: z.string(),
  name: z.string(),
  /** What the class letter or device number means, when the scheme table knows it. */
  label: z.string().optional(),
  source: nodeSource,
  attributes: z.record(z.string(), attributeSchema),
  retired: z.boolean(),
  /** The EAM asset this node was filed as. */
  assetId: z.string().optional(),
  /** The asset's status in the EAM, from its feed. */
  assetStatus: z.enum(['active', 'retired']).optional(),
});
export const treeNodeSchema = z.strictObject({ ...nodeSchema.shape, depth: z.number().int() });

export const documentKind = z.enum(['schematic', 'plan', 'datasheet', 'manual', 'other']);
export const documentSchema = z.strictObject({
  id: recordId,
  title: z.string(),
  kind: documentKind,
  file: blobRefSchema,
  pages: z.number().int().positive().optional(),
  nodeId: recordId.optional(),
  addedBy: z.string(),
  addedAt: timestamp,
});

/** Where an assignment stands; `in-field`, `processed` and `filed` follow from its captures. */
export const assignmentStage = z.enum([
  'draft',
  'dispatched',
  'in-field',
  'returned',
  'processed',
  'filed',
]);
export const assignmentSchema = z.strictObject({
  id: recordId,
  title: z.string(),
  roots: z.array(recordId),
  kinds: z.array(captureKind),
  note: z.string().optional(),
  stage: assignmentStage,
  deviceId: z.string().optional(),
  captures: z.number().int(),
  createdBy: z.string(),
  createdAt: timestamp,
  dispatchedAt: timestamp.optional(),
  returnedAt: timestamp.optional(),
});

/** The slice of the structure a field device receives with an assignment. */
export const fieldNodeSchema = z.strictObject({
  id: recordId,
  parentId: recordId.optional(),
  scheme,
  designation: z.string(),
  name: z.string(),
});
export const fieldAssignmentSchema = z.strictObject({
  id: recordId,
  title: z.string(),
  kinds: z.array(captureKind),
  note: z.string().optional(),
  nodes: z.array(fieldNodeSchema).max(2000),
  /** The hub has the device's return; the device keeps it read-only. */
  returned: z.boolean(),
});

/** Photos a capture may carry: JPEG or PNG, up to 8 MiB each. */
export const photoLimits = { maxBytes: 8 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png'] };
/** Documents: PDF and images up to 32 MiB. */
export const documentLimits = {
  maxBytes: 32 * 1024 * 1024,
  mediaTypes: ['application/pdf', 'image/png', 'image/jpeg'],
};

/** One capture as the field device records it and the hub ingests it. */
export const captureInputSchema = z.strictObject({
  /** Generated on the device, so the same capture is recognised however often it is delivered. */
  id: recordId,
  assignmentId: recordId,
  /** Absent while the capture is unplaced: taken in the field without knowing its node. */
  nodeId: recordId.optional(),
  kind: captureKind,
  photos: z.array(blobRefSchema).min(1).max(8),
  /** Barcodes or tags scanned with the capture. */
  codes: z.array(z.string().min(1).max(128)).max(10),
  condition: condition.optional(),
  note: z.string().max(1000),
  takenAt: timestamp,
});

/** Where a capture stands in review. */
export const reviewStatus = z.enum(['new', 'reviewed', 'discarded']);

/** One value an extraction read, with how sure it is and where on which photo it was found. */
export const proposedFieldSchema = z.strictObject({
  name: attributeName,
  value: z.string().max(200),
  confidence: z.number().min(0).max(1),
  source: z.strictObject({
    digest: z.string(),
    /** Page of a document, when the source is one. */
    page: z.number().int().positive().optional(),
    /** Region as fractions of the image's width and height. */
    region: z
      .strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
  }),
});
export const extractionStatus = z.enum(['requested', 'proposed', 'accepted', 'failed']);
export const extractionSchema = z.strictObject({
  captureId: recordId,
  status: extractionStatus,
  model: z.string().optional(),
  fields: z.array(z.strictObject({ ...proposedFieldSchema.shape, attention: z.boolean() })),
  accepted: z.record(z.string(), z.string()).optional(),
  acceptedBy: z.string().optional(),
  rejection: z.strictObject({ code: z.string(), message: z.string() }).optional(),
});

export const captureSchema = z.strictObject({
  ...captureInputSchema.shape,
  deviceId: z.string(),
  receivedAt: timestamp,
  review: reviewStatus,
  discardReason: z.string().optional(),
  extraction: extractionStatus.optional(),
});
export const captureDetailSchema = z.strictObject({
  ...captureSchema.shape,
  extraction: extractionSchema.optional(),
  node: nodeSchema.optional(),
});

export const filingSchema = z.strictObject({
  id: recordId,
  nodeId: recordId,
  designation: z.string(),
  /** Update this existing EAM asset; absent creates one. */
  assetId: z.string().optional(),
  ...deliveryShape,
  filedBy: z.string(),
  filedAt: timestamp,
});

/** An asset as the EAM search returns it. */
export const assetFoundSchema = z.strictObject({
  externalId: z.string(),
  designation: z.string(),
  name: z.string(),
  manufacturer: z.string().optional(),
  serial: z.string().optional(),
  /** The survey node already filed as this asset. */
  nodeId: z.string().optional(),
});
/** What the EAM feed reports about an asset a filing created or updated. */
export const assetSnapshotSchema = z.strictObject({
  externalId: z.string().max(64),
  designation: z.string().max(64),
  status: z.enum(['active', 'retired']),
});
