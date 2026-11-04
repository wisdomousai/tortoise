import { canonicalJson } from '@tortoise/contracts';
import type { Cursor, Snapshot, Transport } from './types.js';

export interface LiveState<T> {
  readonly data?: T;
  readonly loading: boolean;
  readonly error?: string;
  readonly authorizationRevision: number;
  readonly version: number;
}

/**
 * Snapshot then replay closes the query/subscription race. Each instance is scoped to one
 * instance + principal + grant by its transport; never share it across authenticated sessions.
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
