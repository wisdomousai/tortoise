import { mkdir, open, readdir, readFile, truncate, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import {
  failClosedAuditMode,
  type AuditEvent,
  type AuditMode,
  type AuditRecord,
  type EventLogPort,
} from '@agent-native/contracts';
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

/**
 * Durable JSON-lines event log. Each append writes complete lines and fsyncs before resolving,
 * so a resolved append survives a crash. A torn final line can only come from an append that
 * never resolved (its caller saw a failure and did not proceed); opening the log truncates it and
 * records the truncation in `log.opened`.
 *
 * Files are created 0600 in a 0700 directory. Integrity against a privileged local attacker
 * requires forwarding to an off-host sink; the hash chain makes edits detectable, not impossible.
 */
export async function openJsonlEventLog(options: JsonlEventLogOptions): Promise<JsonlEventLog> {
  const { directory, source } = options;
  const segmentBytes = options.segmentBytes ?? 8 * 1024 * 1024;
  const checkpointEvery = options.checkpointEvery ?? 1000;
  const now = options.now ?? Date.now;
  await mkdir(directory, { recursive: true, mode: 0o700 });

  let head: ChainHead = genesisHead;
  let segment = 1;
  let size = 0;
  let handle: FileHandle | undefined;
  let broken = false;
  let truncatedBytes = 0;

  /** Recover the chain head and current segment from disk. */
  const recover = async () => {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    head = genesisHead;
    segment = 1;
    size = 0;
    const segments = await listSegments(directory);
    for (let i = segments.length - 1; i >= 0; i--) {
      const name = segments[i]!;
      const path = join(directory, name);
      const text = await readFile(path, 'utf8');
      const complete = text.lastIndexOf('\n') + 1;
      if (complete < Buffer.byteLength(text)) {
        truncatedBytes += Buffer.byteLength(text) - Buffer.byteLength(text.slice(0, complete));
        await truncate(path, Buffer.byteLength(text.slice(0, complete)));
      }
      if (i === segments.length - 1) {
        segment = Number(segmentPattern.exec(name)![1]);
        size = Buffer.byteLength(text.slice(0, complete));
      }
      const lines = text.slice(0, complete).split('\n').filter(Boolean);
      if (lines.length) {
        const last = JSON.parse(lines.at(-1)!) as AuditEvent;
        head = { seq: last.seq, hash: last.hash };
        break;
      }
    }
    handle = await open(join(directory, segmentName(segment)), 'a', 0o600);
    broken = false;
  };

  const write = async (events: readonly AuditEvent[]) => {
    if (size >= segmentBytes) {
      await handle!.close();
      segment += 1;
      size = 0;
      handle = await open(join(directory, segmentName(segment)), 'a', 0o600);
    }
    const text = events.map((event) => JSON.stringify(event) + '\n').join('');
    try {
      await handle!.write(text);
      await handle!.sync();
    } catch (error) {
      // The file may hold part of this batch. Re-read the head from disk before the next append.
      broken = true;
      throw error;
    }
    size += Buffer.byteLength(text);
    head = { seq: events.at(-1)!.seq, hash: events.at(-1)!.hash };
  };

  const exclusive = serialized();
  await recover();
  await write(
    sealEvents(
      [
        {
          kind: 'log.opened',
          outcome: 'info',
          data: { resumedSeq: head.seq, segment: segmentName(segment), truncatedBytes },
        },
      ],
      head,
      source,
      now,
    ),
  );

  return {
    mode: options.mode ?? failClosedAuditMode,
    directory,
    head: () => head,
    append: (records: readonly AuditRecord[]) =>
      exclusive(async () => {
        if (broken) await recover();
        if (!records.length) return [];
        const sealed = sealEvents(records, head, source, now);
        const last = sealed.at(-1)!;
        // A checkpoint is due when this batch crosses a multiple of `checkpointEvery`.
        const due = Math.floor(last.seq / checkpointEvery) > Math.floor(head.seq / checkpointEvery);
        const checkpoint = due
          ? sealEvents(
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
            )
          : [];
        await write([...sealed, ...checkpoint]);
        return sealed;
      }),
    close: () => exclusive(async () => void (await handle?.close())),
  };
}
