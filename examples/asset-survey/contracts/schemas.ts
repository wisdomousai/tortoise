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
  /** The reviewer changed the value the extraction proposed, or entered it without one. */
  edited: z.boolean(),
});

/** One node of the site structure. Writes take its fields with these schemas. */
export const nodeSchema = z.strictObject({
  id: recordId,
  parentId: recordId.optional(),
  scheme,
  designation,
  name: text(120),
  /** What the class letter or device number means, when the scheme table knows it. */
  label: z.string().optional(),
  attributes: z.record(z.string(), attributeSchema),
  retired: z.boolean(),
  /** The EAM asset this node was filed as. */
  assetId: z.string().optional(),
  /** The asset's status in the EAM, from its feed. */
  assetStatus: z.enum(['active', 'retired']).optional(),
});

export const documentKind = z.enum(['schematic', 'plan', 'datasheet', 'manual', 'other']);
export const documentSchema = z.strictObject({
  id: recordId,
  title: text(200),
  kind: documentKind,
  file: blobRefSchema,
  pages: z.number().int().positive().max(2000).optional(),
  nodeId: recordId.optional(),
  addedBy: z.string(),
  addedAt: timestamp,
});

/** The slice of the structure a survey's brief carries to the field. */
export const fieldNodeSchema = z.strictObject({
  id: recordId,
  parentId: recordId.optional(),
  scheme,
  designation: z.string(),
  name: z.string(),
});

/** Photos a capture may carry: JPEG or PNG, up to 8 MiB each. */
export const photoLimits = { maxBytes: 8 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png'] };
/** Documents: PDF and images up to 32 MiB. */
export const documentLimits = {
  maxBytes: 32 * 1024 * 1024,
  mediaTypes: ['application/pdf', 'image/png', 'image/jpeg'],
};

/** One capture as the field records it: the body of a survey report. */
export const captureSchema = z.strictObject({
  kind: captureKind,
  photos: z.array(blobRefSchema).min(1).max(8),
  /** Barcodes or tags scanned with the capture. */
  codes: z.array(z.string().min(1).max(128)).max(10),
  condition: condition.optional(),
  note: z.string().max(1000),
  takenAt: timestamp,
});

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

/** The values a reviewer accepts onto a node: names absent are left as they are. */
export const valuesSchema = z.record(attributeName, text(200));

export const filingSchema = z.strictObject({
  id: recordId,
  nodeId: recordId,
  designation: z.string(),
  /** Where the filing goes: the EAM, or a folder in the export directory. */
  target: z.enum(['eam', 'export']),
  /** Update this existing EAM asset; absent creates one. */
  assetId: z.string().optional(),
  /** The filing this one withdraws from the EAM. */
  withdraws: recordId.optional(),
  /** The filing that withdraws this one. */
  withdrawnBy: recordId.optional(),
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
