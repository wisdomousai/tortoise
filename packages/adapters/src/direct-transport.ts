import type { BlobTransport, ChangeBatch, Cursor, Transport } from '@agent-native/client';
import { ApplicationError, type Catalog } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import { withSignal, type ApplicationPort } from './application-port';

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
    const reset =
      after === undefined || revision !== batch.authorizationRevision || batch.reset === true;
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

/** Blobs through the application, under the launcher's context; absent when it keeps none. */
function directBlobs(
  application: ApplicationPort,
  context: ExecutionContext,
): BlobTransport | undefined {
  const { putBlob, readBlob } = application;
  if (!putBlob || !readBlob) return undefined;
  return {
    put: (data, mediaType, signal) =>
      putBlob.call(application, data, mediaType, withSignal(context, signal)),
    get: (digest, signal) => readBlob.call(application, digest, withSignal(context, signal)),
  };
}

/**
 * In-process transport for an embedded instance (stdio MCP or a one-shot CLI in a sandbox).
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
  const blobs = directBlobs(application, context);
  return {
    ...(blobs ? { blobs } : {}),
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
