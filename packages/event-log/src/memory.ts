import {
  failClosedAuditMode,
  type AuditEvent,
  type AuditMode,
  type AuditRecord,
  type EventLogPort,
} from '@agent-native/contracts';
import { genesisHead, sealEvents, serialized, type ChainHead, type EventSource } from './chain';

export interface MemoryEventLogOptions {
  readonly mode?: AuditMode;
  readonly source?: EventSource;
  readonly now?: () => number;
}
export interface MemoryEventLog extends EventLogPort {
  /** Snapshot of everything appended, in order. */
  events(): readonly AuditEvent[];
}

/**
 * In-process log for tests and embedded fixtures. Same sealing and chain as the durable adapter,
 * so a test that verifies its events exercises the production hashing. Not durable.
 */
export function createMemoryEventLog(options: MemoryEventLogOptions = {}): MemoryEventLog {
  const events: AuditEvent[] = [];
  let head: ChainHead = genesisHead;
  const source = options.source ?? { component: 'authority', instance: 'memory' };
  const now = options.now ?? Date.now;
  const exclusive = serialized();
  return {
    mode: options.mode ?? failClosedAuditMode,
    append: (records: readonly AuditRecord[]) =>
      exclusive(async () => {
        const sealed = sealEvents(records, head, source, now);
        events.push(...sealed);
        if (sealed.length) head = { seq: sealed.at(-1)!.seq, hash: sealed.at(-1)!.hash };
        return sealed;
      }),
    events: () => [...events],
  };
}
