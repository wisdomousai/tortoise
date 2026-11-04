import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DeliveryFailure, type PullBatch } from '@tortoise/integration';
import type { FolderPort } from '@tortoise/kernel/plugin';
import {
  extensionOf,
  parseRecords,
  type FileFormat,
  type FileRecord,
  type XmlNames,
} from './formats';

/** Where a feed item came from, for the application's mapping and its error messages. */
export interface FileSource {
  readonly file: string;
  /** Zero-based record index within the file. */
  readonly index: number;
}

export interface FolderFeedOptions<Item> {
  readonly folders: FolderPort;
  /** Folder ID of the result exports. */
  readonly inbox: string;
  readonly format: FileFormat;
  readonly xml?: XmlNames;
  /** Map one record to a feed item. Throwing fails the pass, so a bad file is not skipped silently. */
  readonly map: (record: FileRecord, source: FileSource) => Item;
  /** Files per pull; `more` reports the rest. Default 20. */
  readonly maxFiles?: number;
  /**
   * A file is read only once it has been quiet this long, so a file still being copied in is
   * not read half-written. Default 2 000 ms.
   */
  readonly quietMs?: number;
  readonly now?: () => number;
}

interface Watermark {
  readonly at: number;
  readonly name: string;
}
const after = (a: Watermark, b: Watermark | undefined) =>
  !b || a.at > b.at || (a.at === b.at && a.name > b.name);

function parseCursor(cursor: string | undefined): Watermark | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  const value = JSON.parse(cursor) as Watermark;
  if (typeof value.at !== 'number' || typeof value.name !== 'string')
    throw new Error('Not a folder feed cursor');
  return value;
}

/**
 * Inbound sync from a folder of result exports. The watermark is the time a file was received and
 * its name, so each file is read once, and a file replaced later is read again. The received time is the
 * latest of the file's modification, status-change and creation times, because copy tools keep
 * the source's modification time and the copy would otherwise sort before the watermark. Files
 * are never moved or deleted: the folder is read-only to the application.
 */
export function folderFeed<Item>(options: FolderFeedOptions<Item>) {
  const ext = `.${extensionOf[options.format]}`;
  const maxFiles = options.maxFiles ?? 20;
  const quietMs = options.quietMs ?? 2_000;
  const now = options.now ?? Date.now;
  return async function pull(
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<PullBatch<Item>> {
    signal.throwIfAborted();
    const watermark = parseCursor(cursor);
    let directory: string;
    let names: string[];
    try {
      directory = options.folders.folder(options.inbox).path;
      names = await readdir(directory);
    } catch {
      throw new DeliveryFailure(`The inbox folder ${options.inbox} could not be read`);
    }
    const quiet = now() - quietMs;
    const files: (Watermark & { modified: number })[] = [];
    for (const name of names) {
      if (name.startsWith('.') || !name.toLowerCase().endsWith(ext)) continue;
      const info = await stat(join(directory, name)).catch(() => undefined);
      if (!info?.isFile()) continue;
      const at = Math.max(info.mtimeMs, info.ctimeMs, info.birthtimeMs);
      if (quietMs > 0 && at > quiet) continue;
      const mark = { at, name, modified: info.mtimeMs };
      if (after(mark, watermark)) files.push(mark);
    }
    files.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const batch = files.slice(0, maxFiles);
    const items: Item[] = [];
    for (const file of batch) {
      signal.throwIfAborted();
      const text = await readFile(join(directory, file.name), 'utf8');
      const records = parseRecords(options.format, text, options.xml);
      records.forEach((record, index) =>
        items.push(options.map(record, { file: file.name, index })),
      );
    }
    const last = batch.at(-1);
    return {
      items,
      cursor: last ? JSON.stringify({ at: last.at, name: last.name }) : (cursor ?? ''),
      more: files.length > batch.length,
    };
  };
}
