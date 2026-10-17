import { readFile } from 'node:fs/promises';
import type { ChangeBatch, Cursor, Transport } from '@agent-native/client';
import { ApplicationError, type Catalog } from '@agent-native/contracts';
import type { DelegationGrant, ExecutionContext } from '@agent-native/runtime';
import { withSignal, type ApplicationPort } from './http';

/** Direct cursors are `<journal position>.<authorization revision>`; no session exists to seal them. */
const cursorOf = (position: number, authorizationRevision: number) =>
  `${position}.${authorizationRevision}`;

/** Resolve after `ms`, or as soon as `signal` aborts. */
function pause(signal: AbortSignal, ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Poll the journal after `cursor`, yielding non-empty batches. A reset is yielded when the cursor
 * is unknown or the authorization revision changed, so stale access is never assumed.
 */
async function* directEvents(
  application: ApplicationPort,
  context: ExecutionContext,
  cursor: Cursor,
  signal: AbortSignal,
  pollMs: number,
): AsyncIterable<ChangeBatch> {
  // An empty, foreign or revision-less cursor starts with a reset at the current position.
  const parsed = /^(\d+)\.(\d+)$/.exec(cursor);
  let after = parsed ? Number(parsed[1]) : undefined;
  let revision = parsed ? Number(parsed[2]) : undefined;
  const subscribed = withSignal(context, signal);
  while (!signal.aborted) {
    const batch = await application.events(after ?? 0, subscribed);
    const reset = after === undefined || revision !== batch.authorizationRevision;
    if (reset || batch.events.length)
      yield {
        cursor: cursorOf(batch.cursor, batch.authorizationRevision),
        authorizationRevision: batch.authorizationRevision,
        reset,
        changes: reset
          ? []
          : batch.events.map(({ resource, type, operation, revision: value }) => ({
              resource,
              type,
              operation,
              revision: value,
            })),
      };
    after = batch.cursor;
    revision = batch.authorizationRevision;
    await pause(signal, pollMs);
  }
}

/**
 * In-process transport for an embedded authority (stdio MCP or a one-shot CLI in a sandbox).
 * The launcher fixes `context` once; nothing a caller passes per request can change identity or
 * delegation, and a per-request signal only adds cancellation to the launcher's. Results match the
 * HTTP transport, except cursors are readable journal positions because no network session exists
 * to bind them to. A cursor carries the authorization revision it was issued under, so a
 * subscription resets when access changed between a snapshot and the stream, like HTTP.
 */
export function createDirectTransport(
  application: ApplicationPort,
  context: ExecutionContext,
  options: { pollMs?: number } = {},
): Transport & { catalog(): Promise<Catalog> } {
  return {
    async catalog() {
      return application.discover(context);
    },
    async query<T>(operation: string, input: unknown, signal?: AbortSignal) {
      const result = await application.queryRaw({ operation, input }, withSignal(context, signal));
      return {
        ...result,
        data: result.data as T,
        cursor: cursorOf(result.cursor, result.authorizationRevision),
      };
    },
    async command<T>(
      operation: string,
      input: unknown,
      commandOptions: Parameters<Transport['command']>[2] = {},
    ) {
      if (!commandOptions.idempotencyKey)
        throw new ApplicationError('INVALID_INPUT', 'Commands require an idempotency key');
      const receipt = await application.invokeRaw(
        {
          operation,
          input,
          idempotencyKey: commandOptions.idempotencyKey,
          ...(commandOptions.expectedRevisions
            ? { expectedRevisions: commandOptions.expectedRevisions }
            : {}),
        },
        withSignal(context, commandOptions.signal),
      );
      return {
        operation: receipt.operation,
        result: receipt.result as T,
        cursor: cursorOf(receipt.cursor, receipt.authorizationRevision),
        authorizationRevision: receipt.authorizationRevision,
        revisions: { ...receipt.revisions },
        ...(receipt.effects ? { effects: [...receipt.effects] } : {}),
        ...(receipt.continuation ? { continuation: structuredClone(receipt.continuation) } : {}),
      };
    },
    events: (cursor: Cursor, signal: AbortSignal) =>
      directEvents(application, context, cursor, signal, options.pollMs ?? 250),
  };
}

/**
 * Read a delegation the launcher grants to an embedded agent surface. The file is trusted
 * configuration written by the orchestrator, not by the agent; the authority still applies
 * domain policy for `principalId`, and the grant can only narrow it. Fails closed on any
 * malformed field, an unknown workspace or an expired grant.
 */
export async function readGrantFile(path: string, workspaceId: string): Promise<ExecutionContext> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'Grant file is missing or not JSON');
  }
  const grant = (value ?? {}) as Record<string, unknown>;
  const strings = (item: unknown) =>
    Array.isArray(item) && item.every((entry) => typeof entry === 'string' && entry.length > 0);
  if (
    typeof grant.principalId !== 'string' ||
    !grant.principalId ||
    !strings(grant.operations) ||
    !(grant.operations as string[]).length ||
    (grant.resources !== undefined && !strings(grant.resources)) ||
    (grant.expiresAt !== undefined &&
      (typeof grant.expiresAt !== 'number' || !Number.isFinite(grant.expiresAt))) ||
    (grant.workspaceId !== undefined && grant.workspaceId !== workspaceId) ||
    Object.keys(grant).some(
      (key) =>
        !['principalId', 'operations', 'resources', 'expiresAt', 'workspaceId'].includes(key),
    )
  )
    throw new ApplicationError(
      'INVALID_INPUT',
      'Grant file needs principalId and operations; optional resources, expiresAt, workspaceId',
    );
  if (grant.expiresAt !== undefined && (grant.expiresAt as number) <= Date.now())
    throw new ApplicationError('FORBIDDEN', 'Grant has expired');
  const delegation: DelegationGrant = {
    operations: grant.operations as string[],
    principalId: grant.principalId,
    workspaceId,
    ...(grant.resources ? { resources: grant.resources as string[] } : {}),
    ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt as number } : {}),
  };
  return { workspaceId, principalId: grant.principalId, grant: delegation };
}
