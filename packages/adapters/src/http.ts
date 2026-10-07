import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { ApplicationError, errorEnvelope, type Catalog } from '@agent-native/contracts';
import type {
  CommandReceipt,
  ExecutionContext,
  Invocation,
  QueryResult,
  EventBatch,
} from '@agent-native/runtime';

/** Minimal execution surface shared by all host adapters. No handler implementation lives here. */
export interface ApplicationPort {
  invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult>;
  events(after: number, context: ExecutionContext): Promise<EventBatch>;
  deliverEvents(
    after: number,
    context: ExecutionContext,
    deliver: (batch: EventBatch) => void,
  ): Promise<void>;
  discover(context: ExecutionContext): Catalog;
}
export interface HostSession {
  token: string;
  context: ExecutionContext;
  expiresAt: number;
}

/** Trusted hosts mint credentials. Request bodies never select principals or roles. */
export class Sessions {
  private sessions = new Map<string, HostSession>();
  private launches = new Map<string, { session: HostSession; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  create(context: ExecutionContext, ttl = 86_400_000): HostSession {
    const session = {
      token: randomBytes(32).toString('base64url'),
      context,
      expiresAt: this.now() + ttl,
    };
    this.sessions.set(session.token, session);
    return session;
  }
  launch(session: HostSession): string {
    const key = randomBytes(32).toString('base64url');
    this.launches.set(key, { session, expiresAt: this.now() + 60_000 });
    return key;
  }
  exchange(key: string): HostSession | undefined {
    const launch = this.launches.get(key);
    this.launches.delete(key);
    return launch && launch.expiresAt > this.now() ? this.get(launch.session.token) : undefined;
  }
  get(token: string): HostSession | undefined {
    const session = this.sessions.get(token);
    if (session && session.expiresAt > this.now()) return session;
    this.sessions.delete(token);
    return undefined;
  }
  revoke(token: string): void {
    this.sessions.delete(token);
  }
}

/** Authenticated encryption hides journal counts and binds cursors to a session. Restart resets cursors. */
class Cursors {
  private key = randomBytes(32);
  encode(cursor: number, revision: number, token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(token));
    const data = Buffer.concat([cipher.update(JSON.stringify([cursor, revision])), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }
  decode(value: string, token: string): [number, number] | undefined {
    try {
      const data = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(token));
      decipher.setAuthTag(data.subarray(12, 28));
      const result: unknown = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      );
      if (
        Array.isArray(result) &&
        result.length === 2 &&
        result.every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        return result as [number, number];
    } catch {}
    return undefined;
  }
}

const secureHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const statusCodes = {
  INVALID_INPUT: 400,
  INVALID_OUTPUT: 500,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CANCELLED: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};
export function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { ...secureHeaders, ...headers } });
}

/**
 * Loopback adapter with Host/Origin checks, one-use launch exchange and bounded pull-based SSE.
 * Cursor/event authorization is evaluated immediately before enqueue. Each enqueue is one batch;
 * slow readers are disconnected instead of accumulating sensitive snapshots in a host queue.
 */
export function createHttpHandler(options: {
  application: ApplicationPort;
  sessions: Sessions;
  origin: () => string;
  pollMs?: number;
  publicRoute?: (request: Request) => Promise<Response | undefined>;
  extra?: (request: Request, session: HostSession) => Promise<Response | undefined>;
  static?: (path: string) => Promise<Response | undefined>;
}) {
  const cursors = new Cursors();
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const origin = options.origin();
      if (url.origin !== origin || request.headers.get('host') !== new URL(origin).host)
        return jsonResponse({ error: { code: 'FORBIDDEN', message: 'Untrusted host' } }, 403);
      // OAuth top-level callbacks arrive cross-site. The sole public callback owns its
      // state/nonce/session checks and still passes the authority Host check above.
      const publicResponse = await options.publicRoute?.(request);
      if (publicResponse) return publicResponse;
      const requestOrigin = request.headers.get('origin');
      if (requestOrigin && requestOrigin !== origin)
        return jsonResponse({ error: { code: 'FORBIDDEN', message: 'Untrusted origin' } }, 403);
      if (request.headers.get('sec-fetch-site') === 'cross-site')
        throw new ApplicationError('FORBIDDEN', 'Cross-site requests are forbidden');
      if (url.pathname === '/health' && request.method === 'GET')
        return jsonResponse({ status: 'ready' });
      if (url.pathname === '/api/v1/session' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const session = options.sessions.exchange(
          typeof body.launch === 'string' ? body.launch : '',
        );
        if (!session)
          throw new ApplicationError('FORBIDDEN', 'Launch credential expired or already used');
        return jsonResponse({ connected: true }, 200, {
          'Set-Cookie': `agent_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        });
      }
      if (!url.pathname.startsWith('/api/')) {
        return (await options.static?.(url.pathname)) ?? new Response('Not found', { status: 404 });
      }
      const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
      const cookie = request.headers
        .get('cookie')
        ?.match(/(?:^|;\s*)agent_session=([A-Za-z0-9_-]+)/)?.[1];
      if (!bearer && request.method !== 'GET' && requestOrigin !== origin)
        throw new ApplicationError('FORBIDDEN', 'Browser writes require same-origin validation');
      const session = options.sessions.get(bearer ?? cookie ?? '');
      if (!session) throw new ApplicationError('FORBIDDEN', 'Local session required');
      const context = { ...session.context, channel: 'http' as const, signal: request.signal };
      if (url.pathname === '/api/v1/launch' && request.method === 'POST')
        return jsonResponse({ launch: options.sessions.launch(session) });
      if (url.pathname === '/api/v1/contract' && request.method === 'GET')
        return jsonResponse(options.application.discover(context));
      if (url.pathname === '/api/v1/events' && request.method === 'GET') {
        const decoded = cursors.decode(url.searchParams.get('cursor') ?? '', session.token);
        let after = decoded?.[0] ?? 0;
        let generation = decoded?.[1] ?? -1;
        let first = true;
        const encoder = new TextEncoder();
        let ended = false;
        const stream = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              if (ended) return;
              try {
                if (!first)
                  await new Promise<void>((resolve) => {
                    const done = () => {
                      clearTimeout(timer);
                      request.signal.removeEventListener('abort', done);
                      resolve();
                    };
                    const timer = setTimeout(done, options.pollMs ?? 150);
                    request.signal.addEventListener('abort', done, { once: true });
                  });
                if (request.signal.aborted || !options.sessions.get(session.token)) {
                  ended = true;
                  controller.close();
                  return;
                }
                await options.application.deliverEvents(after, context, (batch) => {
                  if (request.signal.aborted || !options.sessions.get(session.token)) {
                    ended = true;
                    controller.close();
                    return;
                  }
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
                    changes: reset
                      ? []
                      : batch.events.map(({ cursor: _cursor, ...event }) => event),
                  };
                  const frame = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
                  if (frame.byteLength > 262_144) {
                    payload.reset = true;
                    payload.changes = [];
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                  } else controller.enqueue(frame);
                });
              } catch {
                ended = true;
                controller.close();
              }
            },
            cancel() {
              ended = true;
            },
          },
          { highWaterMark: 0 },
        );
        return new Response(stream, {
          headers: {
            ...secureHeaders,
            'Content-Type': 'text/event-stream',
            Connection: 'keep-alive',
          },
        });
      }
      const match = url.pathname.match(/^\/api\/v1\/(commands|queries)\/([^/]+)$/);
      if (match && request.method === 'POST') {
        const body = await readJsonBody(request);
        const operation = decodeURIComponent(match[2]!);
        const invocation: Invocation = {
          operation,
          input: body.input,
          ...(typeof body.idempotencyKey === 'string'
            ? { idempotencyKey: body.idempotencyKey }
            : {}),
          ...(body.expectedRevisions === undefined
            ? {}
            : { expectedRevisions: parseRevisions(body.expectedRevisions) }),
        };
        if (match[1] === 'commands' && !invocation.idempotencyKey)
          throw new ApplicationError('INVALID_INPUT', 'Commands require an idempotency key');
        const result =
          match[1] === 'commands'
            ? await options.application.invokeRaw(invocation, context)
            : await options.application.queryRaw(invocation, context);
        return jsonResponse({
          ...result,
          cursor: cursors.encode(result.cursor, result.authorizationRevision, session.token),
        });
      }
      return (
        (await options.extra?.(request, session)) ??
        jsonResponse({ error: { code: 'NOT_FOUND', message: 'Unknown route' } }, 404)
      );
    } catch (error) {
      const envelope = errorEnvelope(error);
      return jsonResponse({ error: envelope }, statusCodes[envelope.code]);
    }
  };
}

/** Bounded JSON body parsing shared by domain and host routes. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApplicationError('INVALID_INPUT', 'JSON content type required');
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError('INVALID_INPUT', 'JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new ApplicationError('INVALID_INPUT', 'Request exceeds size limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'JSON object required');
  }
}
function parseRevisions(value: unknown): Record<string, number> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some((item) => !Number.isSafeInteger(item) || Number(item) < 0)
  )
    throw new ApplicationError('INVALID_INPUT', 'Expected revisions must be nonnegative integers');
  return value as Record<string, number>;
}
