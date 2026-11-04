import type { z } from 'zod';
import { defineCapability, jsonSchema, type BlobLimits } from '@tortoise/contracts';

/** One operation of the survey: description, UI binding, blobs, and the outbox target it forwards to. */
export function operation<const Id extends string, const Kind extends 'command' | 'query', I, O>(
  id: Id,
  kind: Kind,
  spec: {
    input: z.ZodType<I>;
    output: z.ZodType<O>;
    permission: { action: string; resourceType: string };
    description: string;
    dependencies: readonly string[];
    forwards?: string;
    blobs?: BlobLimits;
    exception?: string;
    /** Operations the handler runs inside its transaction. */
    invokes?: readonly string[];
  },
) {
  return defineCapability({
    id,
    kind,
    description: spec.description,
    input: jsonSchema(spec.input),
    output: jsonSchema(spec.output),
    permission: spec.permission,
    dependencies: spec.dependencies,
    ui: spec.exception ? { exception: spec.exception } : { binding: id },
    ...(spec.blobs ? { blobs: spec.blobs } : {}),
    ...(spec.invokes ? { invokes: spec.invokes } : {}),
    ...(spec.forwards
      ? { integration: { target: spec.forwards, delivery: 'outbox' as const } }
      : {}),
  });
}
