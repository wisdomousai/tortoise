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
  /**
   * Outbox effects this command committed for delivery to another system. Their presence proves
   * the local commit only; delivery and acceptance are reported later through the effect state.
   */
  effects?: readonly string[];
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
