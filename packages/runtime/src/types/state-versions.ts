/**
 * The stored version of one state slice: the version of the code that last migrated it, and the
 * oldest code version that can still read it. They differ when every migration since that
 * version was declared compatible, so a rollback to that version is allowed.
 */
export interface SliceVersion {
  readonly version: number;
  readonly readableFrom: number;
}
/** Slice versions by slice: `application` for the application's own state, `plugin:<id>` for a plugin's. */
export type StateVersions = Readonly<Record<string, SliceVersion>>;

/**
 * How storage brings a stored state to this code's version as it loads it. Storage adapters
 * call `upgrade` for a stored workspace and stamp a new one with `versions`; the upgraded state
 * and stamp are persisted by the next commit. `upgrade` throws to refuse a state this code
 * cannot read (written by newer, incompatible code), so nothing reads or overwrites it.
 */
export interface StateUpgrade<State> {
  readonly versions: StateVersions;
  upgrade(
    state: unknown,
    versions: StateVersions | undefined,
  ): { readonly state: State; readonly versions: StateVersions };
}
