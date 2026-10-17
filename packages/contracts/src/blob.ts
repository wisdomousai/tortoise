import { z } from 'zod';

/** `sha256:` and the lowercase hex SHA-256 of the blob's bytes. */
export const blobDigestPattern = /^sha256:[0-9a-f]{64}$/;
/** A lowercase `type/subtype` media type without parameters. */
export const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/**
 * A reference to immutable bytes held by the workspace's blob store, such as a photo. State,
 * command input and effect payloads carry the reference, never the bytes, so snapshots stay
 * small. The digest names the content; the same bytes always have the same reference.
 */
export interface BlobRef {
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
}

/**
 * Schema for a `BlobRef` field inside an operation's input or output; compose it with
 * `jsonSchema(z.object({ photo: blobRefSchema }))`. Valid shape only: whether the blob exists
 * and the caller may attach it is checked when a command attaches it.
 */
export const blobRefSchema = z.object({
  digest: z.string().regex(blobDigestPattern),
  size: z.number().int().min(0),
  mediaType: z.string().regex(mediaTypePattern),
});

/**
 * What a command may attach to the resources it changes: blobs of at most `maxBytes`, of one of
 * `mediaTypes`. An upload is accepted only when some operation the caller may invoke would accept
 * it, so the largest declared limit bounds what any caller can store.
 */
export interface BlobLimits {
  readonly maxBytes: number;
  readonly mediaTypes: readonly string[];
}

/** Largest `maxBytes` an operation may declare: 256 MiB. */
export const maxBlobBytes = 268_435_456;

export function isBlobRef(value: unknown): value is BlobRef {
  return blobRefSchema.safeParse(value).success;
}

/** Whether a blob of this size and media type fits the limits. */
export function blobFits(limits: BlobLimits, size: number, mediaType: string): boolean {
  return size <= limits.maxBytes && limits.mediaTypes.includes(mediaType);
}

/** Throw unless the limits are a positive size within `maxBlobBytes` and valid media types. */
export function assertBlobLimits(limits: BlobLimits, operation: string): void {
  if (
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes <= 0 ||
    limits.maxBytes > maxBlobBytes
  )
    throw new Error(`Blob size limit must be 1 to ${maxBlobBytes} bytes: ${operation}`);
  if (
    limits.mediaTypes.length === 0 ||
    limits.mediaTypes.some((type) => !mediaTypePattern.test(type))
  )
    throw new Error(`Blob limits need valid media types: ${operation}`);
}
