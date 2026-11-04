import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DeliveryFailure,
  type DeliveryResult,
  type LookupResult,
  type SystemOfRecordPort,
} from '@tortoise/integration';
import type { FolderPort } from '@tortoise/kernel/plugin';
import type { Effect, EffectOutcome } from '@tortoise/runtime';
import {
  extensionOf,
  serializeRecords,
  type FileFormat,
  type FileRecord,
  type XmlNames,
} from './formats';

/** What one effect becomes: the records of its file, or a refusal recorded as business data. */
export type Encoded =
  | { readonly records: readonly FileRecord[] }
  | { readonly rejected: { readonly code: string; readonly message: string } };

export interface FileDropOptions {
  readonly target: string;
  readonly folders: FolderPort;
  /** Folder ID the files are written into. */
  readonly drop: string;
  /** Folder ID of the receipts the other system writes, `<effect id>.json` per file. */
  readonly receipts?: string;
  /** Folder ID the other system moves accepted files into. */
  readonly archive?: string;
  readonly format: FileFormat;
  readonly xml?: XmlNames;
  /** Map an effect (by its `type` and `contractVersion`) to its file's records, or refuse it. */
  readonly encode: (effect: Readonly<Effect>) => Encoded;
  /**
   * Read a receipt. The default reads JSON `{ "status": "accepted", "externalRef"?: string }`,
   * `{ "status": "rejected", "code": string, "message": string }` or `{ "status": "pending" }`.
   */
  readonly decodeReceipt?: (text: string) => EffectOutcome | { readonly status: 'pending' };
}

/** Effect IDs become file names, so they must not name another directory. */
const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const exists = (path: string) =>
  stat(path).then(
    () => true,
    (error: unknown) => {
      if (missing(error)) return false;
      throw new DeliveryFailure('An exchange folder could not be read');
    },
  );

function defaultReceipt(text: string): EffectOutcome | { readonly status: 'pending' } {
  const value = JSON.parse(text) as Record<string, unknown>;
  const string = (key: string) =>
    typeof value[key] === 'string' ? (value[key] as string) : undefined;
  if (value.status === 'pending') return { status: 'pending' };
  if (value.status === 'accepted') {
    const externalRef = string('externalRef');
    return { status: 'accepted', ...(externalRef ? { externalRef } : {}) };
  }
  if (value.status === 'rejected')
    return {
      status: 'rejected',
      code: (string('code') ?? 'REJECTED').slice(0, 100),
      message: (string('message') ?? 'The target rejected the file').slice(0, 500),
    };
  throw new Error('A receipt has no known status');
}

/**
 * A system of record reached by file drop. `deliver` writes `<effect id>.<ext>` atomically
 * (a hidden partial file, then a rename) and returns `pending`; the other system decides, and
 * `lookup` reads its decision from the receipt, or from the file reaching the archive.
 *
 * The other system must keep one rule: write the receipt (or move the file to the archive)
 * before it removes the file from the drop folder, and ignore names starting with a dot. Then
 * `lookup` is sound: it reads the receipt, then the drop folder, then the receipt again and the
 * archive, so a file that left the drop folder between two reads is still found. A file found in
 * none of them was never delivered. Delivery is not idempotent on its own (the other system
 * may already have taken the file), which is why the dispatcher looks up before every resend.
 */
export function fileDropPort(options: FileDropOptions): SystemOfRecordPort {
  if (!options.receipts && !options.archive)
    throw new Error(
      `File target ${options.target} needs a receipts or an archive folder, or a picked-up file cannot be told from one never sent`,
    );
  const decode = options.decodeReceipt ?? defaultReceipt;
  const ext = extensionOf[options.format];
  const nameOf = (effectId: string) => {
    if (!safeName.test(effectId))
      throw new DeliveryFailure('The effect ID cannot be used as a file name');
    return `${effectId}.${ext}`;
  };
  const folder = (id: string) => options.folders.folder(id).path;

  async function receipt(effectId: string) {
    if (!options.receipts) return undefined;
    const text = await readFile(join(folder(options.receipts), `${effectId}.json`), 'utf8').catch(
      (error: unknown) => {
        if (missing(error)) return undefined;
        throw new DeliveryFailure('The receipts folder could not be read');
      },
    );
    if (text === undefined) return undefined;
    try {
      return decode(text);
    } catch {
      return {
        status: 'uncertain',
        reason: 'The receipt for this file could not be read',
      } as const;
    }
  }

  return {
    describe: () => ({ target: options.target, idempotentDelivery: false }),
    async deliver(effect, signal): Promise<DeliveryResult> {
      signal.throwIfAborted();
      const encoded = options.encode(effect);
      if ('rejected' in encoded) return { status: 'rejected', ...encoded.rejected };
      const name = nameOf(effect.id);
      const content = serializeRecords(options.format, encoded.records, options.xml);
      let directory: string;
      try {
        directory = folder(options.drop);
      } catch {
        throw new DeliveryFailure(`The drop folder for ${options.target} is not bound`);
      }
      const partial = join(directory, `.${name}.partial`);
      try {
        await writeFile(partial, content, { flag: 'w' });
        if (signal.aborted) {
          await rm(partial, { force: true });
          signal.throwIfAborted();
        }
        // The rename is the delivery: before it the other system sees nothing it may take.
        await rename(partial, join(directory, name));
      } catch (error) {
        if (signal.aborted) throw error;
        await rm(partial, { force: true }).catch(() => undefined);
        throw new DeliveryFailure(`The drop folder for ${options.target} could not be written`);
      }
      return { status: 'pending', externalRef: name };
    },
    async lookup(effectId): Promise<LookupResult> {
      const name = nameOf(effectId);
      const first = await receipt(effectId);
      if (first) return first;
      if (await exists(join(folder(options.drop), name)))
        return { status: 'pending', externalRef: name };
      const second = await receipt(effectId);
      if (second) return second;
      if (options.archive && (await exists(join(folder(options.archive), name))))
        return { status: 'accepted', externalRef: name };
      return undefined;
    },
  };
}
