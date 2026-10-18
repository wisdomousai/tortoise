import type { ApprovalRequest } from '@agent-native/contracts';
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
  /** Requested commands, such as a discrepancy reason an agent suggests, awaiting a person. */
  approvals: Record<string, ApprovalRequest>;
  // scaffold:state
}

/** A new workspace. Its owner is always an editor. */
export function createState(ownerId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [ownerId]: 'editor' },
    sync: {
      erp: {},
      // scaffold:sync
    },
    deliveries: {},
    approvals: {},
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

/** Whether a counted line differs from its notice, so posting it needs a reason. */
export const discrepant = (delivery: Delivery) =>
  delivery.counted !== undefined && delivery.counted !== delivery.expected;
