import type { Tool } from './contracts/tool';
import type { Loan } from './contracts/loan';
// scaffold:imports

/** Workspace roles: attendants change records, viewers read them. */
export type Role = 'attendant' | 'viewer';

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
  tools: Record<string, Tool>;
  loans: Record<string, Loan>;
  /** The last EAM feed version applied, by asset tag; an older or equal version is dropped. */
  eamVersions: Record<string, number>;
  // scaffold:state
}

/** A new workspace. The local user is always an attendant. */
export function createState(localUserId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [localUserId]: 'attendant' },
    sync: {
      eam: {},
      // scaffold:sync
    },
    tools: {},
    loans: {},
    eamVersions: {},
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
