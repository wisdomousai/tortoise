import { mkdir, open, readdir, readFile, truncate, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import {
  failClosedAuditMode,
  type AuditEvent,
  type AuditMode,
  type AuditRecord,
  type EventLogPort,
} from '@tortoise/contracts';
import { genesisHead, sealEvents, serialized, type ChainHead, type EventSource } from './chain';

export interface JsonlEventLogOptions {
  /** Dedicated directory, separate from the workspace so a workspace reset cannot erase it. */
  readonly directory: string;
  readonly source: EventSource;
  readonly mode?: AuditMode;
  /** Start a new segment once the current one reaches this size. Default 8 MiB. */
  readonly segmentBytes?: number;
  /** Append a `log.checkpoint` carrying the chain head every N events. Default 1000. */
  readonly checkpointEvery?: number;
  readonly now?: () => number;
}
export interface JsonlEventLog extends EventLogPort {
  readonly directory: string;
  head(): ChainHead;
  close(): Promise<void>;
}

/** Another process holds this log open for writing; a chain has exactly one writer. */
export class EventLogLockedError extends Error {
  constructor(readonly directory: string) {
    super('Event log is open in another process');
    this.name = 'EventLogLockedError';
  }
}

const segmentPattern = /^events-(\d{6})\.jsonl$/;
export const segmentName = (index: number) => `events-${String(index).padStart(6, '0')}.jsonl`;

/** Segment file names in chain order. */
export async function listSegments(directory: string): Promise<string[]> {
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  return names.filter((name) => segmentPattern.test(name)).sort();
}

/** Hold the directory's OS writer lock; the returned function releases it. */
async function acquireWriterLock(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = new Database(join(directory, '.writer-lock.sqlite'), { create: true });
  try {
    lock.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;');
  } catch {
    lock.close();
    throw new EventLogLockedError(directory);
  }
  return () => {
    try {
      lock.exec('ROLLBACK');
    } catch {
      /* already released */
    }
    lock.close(true);
  };
}

/** The writer's position: chain head, current segment and its open handle. */
interface Writer {
  readonly directory: string;
  readonly segmentBytes: number;
  head: ChainHead;
  segment: number;
  size: number;
  handle?: FileHandle;
  /** A failed write may have left part of a batch; the head is re-read before the next one. */
  broken: boolean;
  truncatedBytes: number;
}

/** Recover the chain head and current segment from disk, truncating a torn final line. */
async function recover(writer: Writer) {
  await writer.handle?.close().catch(() => undefined);
  writer.handle = undefined;
  writer.head = genesisHead;
  writer.segment = 1;
  writer.size = 0;
  const segments = await listSegments(writer.directory);
  for (let i = segments.length - 1; i >= 0; i--) {
    const name = segments[i]!;
    const path = join(writer.directory, name);
    const text = await readFile(path, 'utf8');
    const complete = text.lastIndexOf('\n') + 1;
    if (complete < Buffer.byteLength(text)) {
      writer.truncatedBytes += Buffer.byteLength(text) - Buffer.byteLength(text.slice(0, complete));
      await truncate(path, Buffer.byteLength(text.slice(0, complete)));
    }
    if (i === segments.length - 1) {
      writer.segment = Number(segmentPattern.exec(name)![1]);
      writer.size = Buffer.byteLength(text.slice(0, complete));
    }
    const lines = text.slice(0, complete).split('\n').filter(Boolean);
    if (lines.length) {
      const last = JSON.parse(lines.at(-1)!) as AuditEvent;
      writer.head = { seq: last.seq, hash: last.hash };
      break;
    }
  }
  writer.handle = await open(join(writer.directory, segmentName(writer.segment)), 'a', 0o600);
  writer.broken = false;
}

/** Append complete lines and fsync, rolling to a new segment once the current one is full. */
async function write(writer: Writer, events: readonly AuditEvent[]) {
  if (writer.size >= writer.segmentBytes) {
    await writer.handle!.close();
    writer.segment += 1;
    writer.size = 0;
    writer.handle = await open(join(writer.directory, segmentName(writer.segment)), 'a', 0o600);
  }
  const text = events.map((event) => JSON.stringify(event) + '\n').join('');
  try {
    await writer.handle!.write(text);
    await writer.handle!.sync();
  } catch (error) {
    // The file may hold part of this batch. Re-read the head from disk before the next append.
    writer.broken = true;
    throw error;
  }
  writer.size += Buffer.byteLength(text);
  writer.head = { seq: events.at(-1)!.seq, hash: events.at(-1)!.hash };
}

/** A `log.checkpoint` after `sealed` when the batch crosses a multiple of `every`. */
function checkpointAfter(
  sealed: readonly AuditEvent[],
  head: ChainHead,
  every: number,
  source: EventSource,
  now: () => number,
): AuditEvent[] {
  const last = sealed.at(-1)!;
  // A checkpoint is due when this batch crosses a multiple of `checkpointEvery`.
  if (Math.floor(last.seq / every) <= Math.floor(head.seq / every)) return [];
  return sealEvents(
    [
      {
        kind: 'log.checkpoint',
        outcome: 'info',
        data: { headSeq: last.seq, headHash: last.hash },
      },
    ],
    { seq: last.seq, hash: last.hash },
    source,
    now,
  );
}

/**
 * Durable JSON-lines event log. Each append writes complete lines and fsyncs before resolving,
 * so a resolved append survives a crash. A torn final line can only come from an append that
 * never resolved (its caller saw a failure and did not proceed); opening the log truncates it and
 * records the truncation in `log.opened`.
 *
 * One writer per directory: an open log holds an OS lock (a live SQLite EXCLUSIVE transaction on
 * `.writer-lock.sqlite`, the same mechanism as workspace ownership) and a second open fails with
 * `EventLogLockedError` instead of forking the chain. The lock dies with the process.
 *
 * Files are created 0600 in a 0700 directory. Integrity against a privileged local attacker
 * requires forwarding to an off-host sink; the hash chain makes edits detectable, not impossible.
 */
export async function openJsonlEventLog(options: JsonlEventLogOptions): Promise<JsonlEventLog> {
  const { directory, source } = options;
  const checkpointEvery = options.checkpointEvery ?? 1000;
  const now = options.now ?? Date.now;
  const releaseLock = await acquireWriterLock(directory);
  const writer: Writer = {
    directory,
    segmentBytes: options.segmentBytes ?? 8 * 1024 * 1024,
    head: genesisHead,
    segment: 1,
    size: 0,
    broken: false,
    truncatedBytes: 0,
  };
  const exclusive = serialized();
  try {
    await recover(writer);
    const opened: AuditRecord = {
      kind: 'log.opened',
      outcome: 'info',
      data: {
        resumedSeq: writer.head.seq,
        segment: segmentName(writer.segment),
        truncatedBytes: writer.truncatedBytes,
      },
    };
    await write(writer, sealEvents([opened], writer.head, source, now));
  } catch (error) {
    await writer.handle?.close().catch(() => undefined);
    releaseLock();
    throw error;
  }

  return {
    mode: options.mode ?? failClosedAuditMode,
    directory,
    head: () => writer.head,
    append: (records: readonly AuditRecord[]) =>
      exclusive(async () => {
        if (writer.broken) await recover(writer);
        if (!records.length) return [];
        const sealed = sealEvents(records, writer.head, source, now);
        const checkpoint = checkpointAfter(sealed, writer.head, checkpointEvery, source, now);
        await write(writer, [...sealed, ...checkpoint]);
        return sealed;
      }),
    close: () =>
      exclusive(async () => {
        await writer.handle?.close();
        writer.handle = undefined;
        releaseLock();
      }),
  };
}
