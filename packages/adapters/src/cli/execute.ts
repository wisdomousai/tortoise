import { ApplicationError, type CatalogOperation, type JsonValue } from '@tortoise/contracts';
import { z } from 'zod';
import { parseJson, usageError } from './args';
import type { CliClient } from './types';

/** Run a query, or a command with an idempotency key (generated unless given). */
export function execute(
  client: CliClient,
  operation: CatalogOperation,
  input: unknown,
  key: string | undefined,
  revisions: string | undefined,
) {
  return operation.kind === 'query'
    ? client.query(operation.id, input)
    : client.command(operation.id, input, {
        idempotencyKey: key ?? crypto.randomUUID(),
        expectedRevisions:
          revisions === undefined
            ? undefined
            : (parseJson(revisions, '--revisions') as Record<string, number>),
      });
}

/**
 * Validate against the published input schema and the caller's coarse availability without
 * executing. Advisory only: the instance re-validates and authorizes the object at commit time.
 */
export function validateOnly(operation: CatalogOperation, input: unknown) {
  const availability = (operation as CatalogOperation & { availability?: string }).availability;
  if (availability === 'denied')
    throw new ApplicationError('FORBIDDEN', `${operation.id} is not available to this caller`);
  const parsed = z.fromJSONSchema(operation.inputSchema as never).safeParse(input);
  if (!parsed.success)
    throw usageError(
      'Input does not match the operation schema',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  return {
    dryRun: true,
    operation: operation.id,
    kind: operation.kind,
    input: input as JsonValue,
    availability: availability ?? 'conditional',
  };
}
