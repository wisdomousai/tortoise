import { z } from 'zod';

/**
 * The `filing-export` process protocol: one request line on stdin, one answer line on stdout,
 * then the process exits. A process per filing keeps the worker stateless; exports are rare
 * next to the cost of starting it.
 *
 * Request: `{ id, folder, record, photos: [{ file, digest, data }] }`, where `id` is the effect
 * ID, `folder` the folder name inside the export directory, `record` what `record.json` holds
 * besides `effectId`, and `data` each photo's bytes in base64.
 * Answer: `{ id, folder }` once the folder is in place, or `{ id, error }`.
 */
export const exportRequestSchema = z.strictObject({
  id: z.string().min(1).max(128),
  // One path segment: no separators, no dot-only names, nothing hidden.
  folder: z
    .string()
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._=+-]*$/),
  record: z.record(z.string(), z.unknown()),
  photos: z
    .array(
      z.strictObject({
        file: z.string().regex(/^photos\/[0-9a-f]{64}\.(?:jpg|png)$/),
        digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        data: z.string(),
      }),
    )
    .max(50),
});
export type ExportRequest = z.output<typeof exportRequestSchema>;

export const exportAnswerSchema = z.union([
  z.strictObject({ id: z.string(), folder: z.string().max(160) }),
  z.strictObject({ id: z.string(), error: z.string().max(500) }),
]);
export type ExportAnswer = z.output<typeof exportAnswerSchema>;
