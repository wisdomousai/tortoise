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
  /** The command this one ran in the same transaction (a proposal's command), with its result. */
  continuation?: { operation: string; result: unknown };
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
/** A blob reference as the authority returns it; see `BlobRef` in the contracts. */
export interface BlobReference {
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
}
/**
 * Upload and read blobs such as photos. `put` returns the reference a command then attaches;
 * `get` fails with NOT_FOUND unless the caller may read a resource that references the blob.
 */
export interface BlobTransport {
  put(data: Uint8Array, mediaType: string, signal?: AbortSignal): Promise<BlobReference>;
  get(
    digest: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ref: BlobReference; readonly data: Uint8Array }>;
}
export interface Transport {
  query<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<Snapshot<T>>;
  command<T>(operation: string, input: unknown, options?: CommandOptions): Promise<Receipt<T>>;
  events(cursor: Cursor, signal: AbortSignal): AsyncIterable<ChangeBatch>;
  /** Present when the authority keeps blobs. */
  readonly blobs?: BlobTransport;
}
