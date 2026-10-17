import { ApplicationError, type Catalog, type ErrorEnvelope } from '@agent-native/contracts';
import type {
  BlobReference,
  BlobTransport,
  ChangeBatch,
  CommandOptions,
  Receipt,
  Snapshot,
  Transport,
} from './types.js';

/** Server-sent event frames of change batches; a frame over 1 MiB aborts the stream. */
async function* readEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<ChangeBatch> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 1_048_576) throw new Error('Event frame exceeds limit');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (data) yield JSON.parse(data) as ChangeBatch;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The error envelope of a failed response, as an `ApplicationError`. */
async function failure(response: Response): Promise<ApplicationError> {
  // `details` is caller-safe structured context (for example the offending input field);
  // keep it so forms can attach server validation to the right control.
  const payload = (await response.json().catch(() => ({}))) as { error?: ErrorEnvelope };
  return new ApplicationError(
    payload.error?.code ?? 'INTERNAL',
    payload.error?.message ?? `HTTP ${response.status}`,
    payload.error?.details,
  );
}

/** Blob upload and download over the same credentials as the other requests. */
function httpBlobs(
  request: typeof fetch,
  base: string,
  authorization: () => Record<string, string>,
): BlobTransport {
  return {
    async put(data, mediaType, signal) {
      const response = await request(`${base}/api/v1/blobs`, {
        method: 'POST',
        headers: { 'Content-Type': mediaType, ...authorization() },
        credentials: 'same-origin',
        body: data as Uint8Array<ArrayBuffer>,
        signal,
      });
      if (!response.ok) throw await failure(response);
      return (await response.json()) as BlobReference;
    },
    async get(digest, signal) {
      const response = await request(`${base}/api/v1/blobs/${encodeURIComponent(digest)}`, {
        headers: authorization(),
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok) throw await failure(response);
      const data = new Uint8Array(await response.arrayBuffer());
      const mediaType = response.headers.get('content-type') ?? 'application/octet-stream';
      return { ref: { digest, size: data.byteLength, mediaType }, data };
    },
  };
}

/** HTTP credentials are injected by the trusted process; browser clients use an HttpOnly cookie. */
export function createHttpTransport(options: {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}): Transport & { catalog(): Promise<Catalog> } {
  const request = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  const authorization = (): Record<string, string> =>
    options.token ? { Authorization: `Bearer ${options.token}` } : {};
  const headers = () => ({ 'Content-Type': 'application/json', ...authorization() });
  async function json<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await request(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: headers(),
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as T;
  }
  return {
    catalog: () => json<Catalog>('/api/v1/contract'),
    query: <T>(operation: string, input: unknown, signal?: AbortSignal) =>
      json<Snapshot<T>>(`/api/v1/queries/${encodeURIComponent(operation)}`, { input }, signal),
    command: <T>(operation: string, input: unknown, command: CommandOptions = {}) =>
      json<Receipt<T>>(
        `/api/v1/commands/${encodeURIComponent(operation)}`,
        {
          input,
          idempotencyKey: command.idempotencyKey ?? crypto.randomUUID(),
          expectedRevisions: command.expectedRevisions,
        },
        command.signal,
      ),
    async *events(cursor, signal) {
      const response = await request(`${base}/api/v1/events?cursor=${encodeURIComponent(cursor)}`, {
        headers: authorization(),
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok || !response.body)
        throw new ApplicationError('FORBIDDEN', 'Event stream unavailable');
      yield* readEventStream(response.body, signal);
    },
    blobs: httpBlobs(request, base, authorization),
  };
}
