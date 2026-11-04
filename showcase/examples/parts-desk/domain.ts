import type { z } from 'zod';
import type { Inquiry } from './contracts/inquiry';
import type { Customer } from './contracts/customer';
import type { Transformer } from './contracts/transformer';
import type { Part } from './contracts/part';
import type { Quote } from './contracts/quote';
import type { roleSchema } from './contracts/member-current';
// scaffold:imports

/**
 * Workspace roles: desk members change records, supervisors may do what desk members do and set
 * a quote's discount above 10 percent, viewers read records.
 */
export type Role = z.output<typeof roleSchema>;

/** Where a target's inbound sync stands. */
export interface Cursor {
  watermark?: string;
  lastSyncAt?: number;
}

/** The application's state. Records are keyed objects; read them with `own`, write with `records`. */
export interface AppState {
  /** People who work in this workspace and their role. */
  members: Record<string, Role>;
  /** Inbound sync positions by target. */
  sync: Record<string, Cursor>;
  inquiries: Record<string, Inquiry>;
  customers: Record<string, Customer>;
  transformers: Record<string, Transformer>;
  parts: Record<string, Part>;
  quotes: Record<string, Quote>;
  // scaffold:state
}

/** A new workspace. The local user is always a desk member. */
export function createState(localUserId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [localUserId]: 'desk' },
    sync: {
      // scaffold:sync
    },
    inquiries: {},
    customers: {},
    transformers: {},
    parts: {},
    quotes: {},
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
