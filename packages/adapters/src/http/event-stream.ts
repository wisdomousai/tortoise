import type { EventBatch, ExecutionContext } from '@agent-native/runtime';
import type { ApplicationPort } from '../http';
import type { Cursors } from './cursors';
import { secureHeaders } from './response';
import type { HostSession, Sessions } from './sessions';

interface StreamOptions {
  readonly application: ApplicationPort;
  readonly sessions: Sessions;
  readonly cursors: Cursors;
  readonly pollMs?: number;
}

/** Wait one poll interval, or less if the request is aborted. */
function pause(signal: AbortSignal, pollMs: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, pollMs);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Bounded pull-based SSE for one session. Each pull delivers at most one batch, authorized
 * immediately before enqueue; the stream closes once the request aborts or the session ends.
 */
export function eventStreamResponse(
  options: StreamOptions,
  request: Request,
  session: HostSession,
  context: ExecutionContext,
): Response {
  const { cursors } = options;
  const decoded = cursors.decode(
    new URL(request.url).searchParams.get('cursor') ?? '',
    session.token,
  );
  let after = decoded?.[0] ?? 0;
  let generation = decoded?.[1] ?? -1;
  let first = true;
  const encoder = new TextEncoder();
  let ended = false;
  const live = () => !request.signal.aborted && !!options.sessions.get(session.token);
  /** One SSE frame; a frame over 256 KiB is replaced by a reset. */
  const frame = (batch: EventBatch) => {
    // No await between final access decision and enqueue. Reset rather than disclose
    // identifiers when membership changed or the caller presents an unknown cursor.
    const reset =
      (first && !decoded) ||
      generation !== batch.authorizationRevision ||
      (batch.cursor > after && batch.events.length === 0);
    first = false;
    after = batch.cursor;
    generation = batch.authorizationRevision;
    const payload = {
      cursor: cursors.encode(after, generation, session.token),
      authorizationRevision: generation,
      reset,
      changes: reset ? [] : batch.events.map(({ cursor: _cursor, ...event }) => event),
    };
    const encoded = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
    if (encoded.byteLength <= 262_144) return encoded;
    payload.reset = true;
    payload.changes = [];
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (ended) return;
        const end = () => {
          ended = true;
          controller.close();
        };
        try {
          if (!first) await pause(request.signal, options.pollMs ?? 150);
          if (!live()) return end();
          await options.application.deliverEvents(after, context, (batch) => {
            if (!live()) return end();
            controller.enqueue(frame(batch));
          });
        } catch {
          end();
        }
      },
      cancel() {
        ended = true;
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(stream, {
    headers: { ...secureHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' },
  });
}
