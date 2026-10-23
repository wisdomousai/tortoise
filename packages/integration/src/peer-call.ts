import type { Catalog, ErrorEnvelope, JsonValue } from '@agent-native/contracts';

/** A `fetch` bound to the peer's origin, as `NetworkPort.client` returns it. */
export interface PeerClient {
  readonly fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * A peer call that got no answer it could use.
 *
 * - `disconnected`: there is no client, such as a device that is not paired.
 * - `unreachable`: the request did not complete.
 * - `answered`: the peer answered with an error status; `envelope` holds its error body, if any.
 */
export class PeerCallError extends Error {
  constructor(
    message: string,
    readonly kind: 'disconnected' | 'unreachable' | 'answered',
    readonly status?: number,
    readonly envelope?: ErrorEnvelope,
  ) {
    super(message);
    this.name = 'PeerCallError';
  }
  get code() {
    return this.envelope?.code;
  }
}

/** What the peer's command route answers: its receipt, without the session-bound cursor. */
export interface PeerReceipt<T = unknown> {
  readonly operation: string;
  readonly result: T;
  readonly effects?: readonly string[];
}

export interface PeerCallOptions {
  /** Asked on every call, so a connection made after this was built is used; a throw is `disconnected`. */
  readonly client: () => PeerClient;
  /** Sent with every request, such as the bearer credential. */
  readonly headers?: () => Readonly<Record<string, string>>;
}

/** The peer's HTTP API: commands, queries, blobs and plain JSON posts such as enrollment. */
export interface PeerCall {
  command<T = unknown>(
    operation: string,
    input: unknown,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PeerReceipt<T>>;
  query<T = unknown>(operation: string, input?: unknown, signal?: AbortSignal): Promise<T>;
  /** Store a blob on the peer; returns the digest the peer stored it under. */
  upload(mediaType: string, data: Uint8Array, signal?: AbortSignal): Promise<string>;
  blob(digest: string, signal?: AbortSignal): Promise<Uint8Array>;
  post<T = unknown>(path: string, body: JsonValue, signal?: AbortSignal): Promise<T>;
  /** The contract the peer serves this caller: its application, operations and schema digests. */
  contract(signal?: AbortSignal): Promise<Catalog>;
}

/**
 * The HTTP mapping every peer caller shares: the fleet agent, the peer port and peer links.
 * Paths resolve against the client's origin and redirects are errors, so a credential in
 * `headers` never reaches another host.
 */
export function createPeerCall(options: PeerCallOptions): PeerCall {
  async function send(path: string, init: RequestInit) {
    let client: PeerClient;
    try {
      client = options.client();
    } catch (error) {
      throw new PeerCallError((error as Error).message, 'disconnected');
    }
    try {
      return await client.fetch(path, {
        ...init,
        headers: { ...options.headers?.(), ...(init.headers as Record<string, string>) },
        redirect: 'error',
      });
    } catch (error) {
      throw new PeerCallError((error as Error).message, 'unreachable');
    }
  }
  async function json<T>(response: Response): Promise<T> {
    const body = (await response.json().catch(() => undefined)) as
      (T & { error?: ErrorEnvelope }) | undefined;
    if (!response.ok || !body)
      throw new PeerCallError(
        body?.error ? `${body.error.code} ${body.error.message}` : `answered ${response.status}`,
        'answered',
        response.status,
        body?.error,
      );
    return body;
  }
  const postJson = (path: string, body: unknown, signal?: AbortSignal) =>
    send(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  return {
    async command<T>(
      operation: string,
      input: unknown,
      idempotencyKey: string,
      signal?: AbortSignal,
    ) {
      const response = await postJson(
        `/api/v1/commands/${encodeURIComponent(operation)}`,
        { input, idempotencyKey },
        signal,
      );
      const { operation: answered, result, effects } = await json<PeerReceipt<T>>(response);
      return { operation: answered, result, ...(effects ? { effects } : {}) };
    },
    async query<T>(operation: string, input: unknown = {}, signal?: AbortSignal) {
      const response = await postJson(
        `/api/v1/queries/${encodeURIComponent(operation)}`,
        { input },
        signal,
      );
      return (await json<{ data: T }>(response)).data;
    },
    async upload(mediaType: string, data: Uint8Array, signal?: AbortSignal) {
      const response = await send('/api/v1/blobs', {
        method: 'POST',
        headers: { 'Content-Type': mediaType },
        body: data as Uint8Array<ArrayBuffer>,
        ...(signal ? { signal } : {}),
      });
      return (await json<{ digest?: string }>(response)).digest ?? '';
    },
    async blob(digest: string, signal?: AbortSignal) {
      const response = await send(`/api/v1/blobs/${encodeURIComponent(digest)}`, {
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) await json(response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async post<T>(path: string, body: JsonValue, signal?: AbortSignal) {
      return json<T>(await postJson(path, body, signal));
    },
    async contract(signal?: AbortSignal) {
      return json<Catalog>(await send('/api/v1/contract', { ...(signal ? { signal } : {}) }));
    },
  };
}
