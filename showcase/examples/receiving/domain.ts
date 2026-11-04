import type { StateMigrations } from '@tortoise/runtime';
import type { Delivery } from './contracts/delivery';
// scaffold:imports

/** Workspace roles: editors count and post, viewers read. */
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
  deliveries: Record<string, Delivery>;
  // scaffold:state
}

/** A new workspace. The local user is always an editor. */
export function createState(localUserId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [localUserId]: 'editor' },
    sync: {
      erp: {},
      quality: {},
      // scaffold:sync
    },
    deliveries: {},
    // scaffold:initial
  };
}

/**
 * Version 2 moved approval requests from `approvals` into the `approval` feature's slice, which
 * adopts them first (`application.ts`). The step is not compatible, so code from version 1
 * refuses a version 2 workspace instead of running without its approval requests.
 */
export const migrations: StateMigrations = {
  version: 2,
  steps: [
    {
      from: 1,
      to: 2,
      up: (stored) => {
        const { approvals: _moved, ...rest } = stored as Record<string, unknown>;
        return rest;
      },
    },
  ],
};

/**
 * A stored workspace under the current code: record sets added since it was created start
 * empty and new targets start without a watermark. Nothing stored is dropped.
 */
export function upgradeState(stored: unknown, fresh: AppState): AppState {
  const previous = (stored ?? {}) as Partial<AppState>;
  return { ...fresh, ...previous, sync: { ...fresh.sync, ...previous.sync } };
}

/** Whether a counted line differs from its notice, so posting it needs a reason. */
export const discrepant = (delivery: Delivery) =>
  delivery.counted !== undefined && delivery.counted !== delivery.expected;
