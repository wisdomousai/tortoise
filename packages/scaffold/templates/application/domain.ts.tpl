// scaffold:imports

/** Workspace roles: editors change records, viewers read them. */
export type Role = 'editor' | 'viewer';

/** Where a target's feed stands. */
export interface Cursor {
  watermark?: string;
  lastSyncAt?: number;
}

/** The application's state. Records are keyed objects; read them with `own`, write with `records`. */
export interface AppState {
  /** People who work in this workspace and their role. */
  members: Record<string, Role>;
  /** Feed positions by target. */
  sync: Record<string, Cursor>;
  // scaffold:state
}

/** A new workspace. The local user is always an editor. */
export function createState(localUserId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [localUserId]: 'editor' },
    sync: {
      // scaffold:sync
    },
    // scaffold:initial
  };
}

/**
 * A stored workspace under the current code: record sets added since it was created start
 * empty and new targets start without a watermark. Nothing stored is dropped.
 */
export function upgradeState(stored: unknown, fresh: AppState): AppState {
  const previous = (stored ?? {}) as Partial<AppState>;
  return { ...fresh, ...previous, sync: { ...fresh.sync, ...previous.sync } };
}
