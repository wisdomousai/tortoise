import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  canonicalJson,
  type AuditRecord,
  type EventLogPort,
  type JsonObject,
} from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';

/** A refusal or acceptance as the status query shows it; never content. */
export interface OsActivity {
  readonly at: number;
  readonly kind:
    'os.request.received' | 'os.request.refused' | 'os.action.performed' | 'os.action.refused';
  readonly id?: string;
  readonly reason?: string;
  readonly platform?: string;
}

/** SHA-256 of the canonical JSON, so an auditor can match a request without the log holding it. */
export const digestOf = (value: unknown) =>
  `sha256:${bytesToHex(sha256(utf8ToBytes(canonicalJson(value as JsonObject))))}`;

/**
 * Records OS activity on the `shell` channel and keeps the last 32 entries for the status
 * query. Records carry ids, kinds, platforms, reason codes and digests, never request content
 * or full URLs. Without an event log the entries are kept in memory only.
 */
export function createOsAudit(eventLog: () => EventLogPort | undefined, now: () => number) {
  const recent: OsActivity[] = [];
  return {
    recent: () => [...recent],
    async record(
      context: ExecutionContext,
      activity: Omit<OsActivity, 'at'>,
      data: JsonObject = {},
    ) {
      const entry: OsActivity = { at: now(), ...activity };
      recent.push(entry);
      if (recent.length > 32) recent.shift();
      const record: AuditRecord = {
        kind: activity.kind,
        outcome: activity.kind.endsWith('refused')
          ? 'denied'
          : activity.kind.endsWith('performed')
            ? 'completed'
            : 'allowed',
        actor: { principalId: context.principalId, workspaceId: context.workspaceId, via: 'shell' },
        ...(activity.id ? { operation: activity.id } : {}),
        ...(activity.reason ? { reason: activity.reason } : {}),
        data: { ...(activity.platform ? { platform: activity.platform } : {}), ...data },
      };
      await eventLog()?.append([record]);
    },
  };
}
export type OsAudit = ReturnType<typeof createOsAudit>;

/** At most `limit` uses per id in any `windowMs`, so a flood from one sender cannot crowd others out. */
export function createRateLimit(limit: number, windowMs: number, now: () => number) {
  const uses = new Map<string, number[]>();
  return (id: string) => {
    const since = now() - windowMs;
    const recent = (uses.get(id) ?? []).filter((at) => at > since);
    if (recent.length >= limit) {
      uses.set(id, recent);
      return false;
    }
    recent.push(now());
    uses.set(id, recent);
    return true;
  };
}
