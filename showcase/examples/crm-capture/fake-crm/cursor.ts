import { ApplicationError } from '@tortoise/contracts';
import type { SearchPage } from '@tortoise/integration';
import type { SourceRequest } from '@tortoise/runtime';

/** Records per page when the caller does not ask for a limit; small so the demo pages. */
export const PAGE_SIZE = 5;

/** What a cursor is bound to: the operation, the search text and the CRM user behind it. */
interface Scope {
  readonly operation: string;
  readonly q: string;
  readonly user: string;
}

const encode = (value: Scope & { offset: number }) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function offsetOf(cursor: string, scope: Scope): number {
  let decoded: Partial<Scope & { offset: number }> = {};
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    // Falls through to the refusal below.
  }
  const { offset } = decoded;
  if (
    decoded.operation !== scope.operation ||
    decoded.q !== scope.q ||
    decoded.user !== scope.user ||
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new ApplicationError('INVALID_INPUT', 'Search cursor does not belong to this search');
  return offset;
}

/**
 * One page of `records`. Like a real CRM's query locator, the cursor is opaque to callers and
 * valid only for the search and the CRM user that produced it: replayed under another
 * credential or for another search, it is refused instead of widening what the caller reads.
 * This fake encodes the binding in the cursor and checks it; a real target keeps it server-side.
 */
export function page(request: SourceRequest, user: string, records: unknown[]): SearchPage {
  const query = request.query as { q?: string; limit?: number; cursor?: string };
  const scope = { operation: request.operation, q: query.q ?? '', user };
  const offset = query.cursor ? offsetOf(query.cursor, scope) : 0;
  const end = offset + (query.limit ?? PAGE_SIZE);
  return {
    items: records.slice(offset, end),
    ...(end < records.length ? { next: encode({ ...scope, offset: end }) } : {}),
  };
}
