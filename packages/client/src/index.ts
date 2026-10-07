import {
  ApplicationError,
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
  type Catalog,
  type ErrorCode,
} from '@agent-native/contracts';

/** Opaque host cursor. A restart or unknown cursor causes a fresh snapshot. */
export type Cursor = string;
export interface Snapshot<T> {
  data: T;
  cursor: Cursor;
  authorizationRevision: number;
}
export interface Receipt<T> {
  result: T;
  cursor: Cursor;
  authorizationRevision: number;
  revisions: Record<string, number>;
  operation: string;
}
export interface ChangeBatch {
  cursor: Cursor;
  authorizationRevision: number;
  reset: boolean;
  changes: readonly { resource: string; type: string; operation: string; revision: number }[];
}
export interface CommandOptions {
  idempotencyKey?: string;
  expectedRevisions?: Readonly<Record<string, number>>;
  signal?: AbortSignal;
}
export interface Transport {
  query<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<Snapshot<T>>;
  command<T>(operation: string, input: unknown, options?: CommandOptions): Promise<Receipt<T>>;
  events(cursor: Cursor, signal: AbortSignal): AsyncIterable<ChangeBatch>;
}

/** HTTP credentials are injected by the trusted process; browser clients use an HttpOnly cookie. */
export function createHttpTransport(options: {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}): Transport & { catalog(): Promise<Catalog> } {
  const request = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });
  async function json<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await request(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: headers(),
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = payload as { error?: { code: ErrorCode; message: string } };
      throw new ApplicationError(
        error.error?.code ?? 'INTERNAL',
        error.error?.message ?? `HTTP ${response.status}`,
      );
    }
    return payload as T;
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
        headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok || !response.body)
        throw new ApplicationError('FORBIDDEN', 'Event stream unavailable');
      const reader = response.body.getReader();
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
    },
  };
}

/** Typed capability bindings preserve the input/output types declared by an independently authored module. */
export function createClient(transport: Transport) {
  return {
    transport,
    query<C extends AnyCapability>(
      capability: C & { kind: 'query' },
      input: InputOf<C>,
      signal?: AbortSignal,
    ) {
      return transport.query<OutputOf<C>>(capability.id, input, signal);
    },
    command<C extends AnyCapability>(
      capability: C & { kind: 'command' },
      input: InputOf<C>,
      options?: CommandOptions,
    ) {
      return transport.command<OutputOf<C>>(capability.id, input, options);
    },
  };
}

export interface LiveState<T> {
  readonly data?: T;
  readonly loading: boolean;
  readonly error?: string;
  readonly authorizationRevision: number;
  readonly version: number;
}

/**
 * Snapshot then replay closes the query/subscription race. Each instance is scoped to one
 * authority + principal + grant by its transport; never share it across authenticated sessions.
 * A generation fence prevents an older request from restoring revoked or superseded data.
 */
export class LiveQuery<T> {
  private state: LiveState<T> = { loading: true, authorizationRevision: -1, version: 0 };
  private readonly listeners = new Set<() => void>();
  private active?: AbortController;
  private generation = 0;
  constructor(
    private readonly transport: Transport,
    readonly operation: string,
    readonly input: unknown,
  ) {
    canonicalJson(input);
  }
  getSnapshot = (): LiveState<T> => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.active) {
      this.active = new AbortController();
      void this.follow(this.active.signal);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  };
  private publish(next: Omit<LiveState<T>, 'version'>) {
    this.state = { ...next, version: this.state.version + 1 };
    for (const listener of this.listeners) listener();
  }
  /** Clears privileged state immediately; an old in-flight response cannot restore it. */
  clear(): void {
    this.generation++;
    this.publish({ loading: true, authorizationRevision: this.state.authorizationRevision });
  }
  stop(): void {
    this.generation++;
    this.active?.abort();
    this.active = undefined;
  }
  private async refresh(signal: AbortSignal): Promise<Snapshot<T> | undefined> {
    const generation = ++this.generation;
    let snapshot: Snapshot<T>;
    try {
      snapshot = await this.transport.query<T>(this.operation, this.input, signal);
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return undefined;
      throw error;
    }
    if (
      signal.aborted ||
      generation !== this.generation ||
      snapshot.authorizationRevision < this.state.authorizationRevision
    )
      return undefined;
    this.publish({
      data: snapshot.data,
      loading: false,
      authorizationRevision: snapshot.authorizationRevision,
    });
    return snapshot;
  }
  private async follow(signal: AbortSignal): Promise<void> {
    let cursor: Cursor | undefined;
    while (!signal.aborted) {
      try {
        const snapshot = await this.refresh(signal);
        if (!snapshot) continue;
        cursor = snapshot.cursor;
        for await (const batch of this.transport.events(cursor, signal)) {
          if (signal.aborted) break;
          cursor = batch.cursor;
          if (batch.authorizationRevision < this.state.authorizationRevision) continue;
          const generationChanged = batch.authorizationRevision > this.state.authorizationRevision;
          if (batch.reset || generationChanged) {
            this.clear();
            this.publish({ loading: true, authorizationRevision: batch.authorizationRevision });
          }
          // Re-query collection membership as well as existing records. This conservative
          // v1 strategy avoids missed creates/deletes; adapters may coalesce by dependency.
          // Keep consuming revocations even when a previous query is slow. Generation
          // fencing discards the earlier response after a reset or a newer refresh.
          if (batch.reset || batch.changes.length || generationChanged)
            void this.refresh(signal).catch((error) => {
              if (!signal.aborted)
                this.publish({
                  loading: false,
                  error: error instanceof Error ? error.message : 'Query failed',
                  authorizationRevision: this.state.authorizationRevision,
                });
            });
        }
      } catch (error) {
        if (signal.aborted) return;
        this.publish({
          loading: false,
          error: error instanceof Error ? error.message : 'Query failed',
          authorizationRevision: this.state.authorizationRevision,
        });
      }
      if (!signal.aborted)
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 500);
          signal.addEventListener('abort', finish, { once: true });
        });
    }
  }
}
