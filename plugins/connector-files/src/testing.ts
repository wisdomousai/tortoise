import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoundFolder, FolderPort } from '@agent-native/kernel/plugin';
import { parseRecords, type FileFormat, type FileRecord } from './formats';

/** A folder port over a temporary directory per folder ID, for tests. */
export async function temporaryFolders(ids: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'agent-files-'));
  const paths = new Map<string, string>();
  for (const id of ids) {
    const path = join(root, id);
    await mkdir(path);
    paths.set(id, path);
  }
  let failing: string | undefined;
  const port: FolderPort = {
    folder(id): BoundFolder {
      const path = paths.get(id);
      if (!path) throw new Error(`Folder ${id} is not bound`);
      if (failing === id) {
        failing = undefined;
        return { id, path: join(root, 'unmounted', id), access: 'read-write' };
      }
      return { id, path, access: 'read-write' };
    },
  };
  return {
    port,
    path: (id: string) => paths.get(id)!,
    /** The next lookup of `id` names a directory that does not exist, as an unmounted share. */
    unmountNext: (id: string) => {
      failing = id;
    },
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * The other system's side of a file drop, for tests: it takes each file from the drop folder,
 * decides it, writes the receipt (or moves the file to the archive) and only then removes it,
 * as `fileDropPort` requires. `applied` counts what it accepted per effect ID.
 */
export class FakeFileConsumer {
  readonly applied = new Map<string, number>();
  readonly records = new Map<string, readonly FileRecord[]>();
  constructor(
    private readonly options: {
      readonly drop: string;
      readonly receipts?: string;
      readonly archive?: string;
      readonly format: FileFormat;
      /** A refusal for a file's records, or undefined to accept them. */
      readonly decide?: (
        records: readonly FileRecord[],
      ) => { code: string; message: string } | undefined;
    },
  ) {}

  /** Take every complete file now in the drop folder. */
  async process() {
    const { drop, receipts, archive, format } = this.options;
    for (const name of await readdir(drop)) {
      if (name.startsWith('.')) continue;
      const effectId = name.slice(0, name.lastIndexOf('.'));
      const records = parseRecords(format, await readFile(join(drop, name), 'utf8'));
      const refusal = this.options.decide?.(records);
      if (!refusal) {
        this.applied.set(effectId, (this.applied.get(effectId) ?? 0) + 1);
        this.records.set(effectId, records);
      }
      if (receipts) {
        const receipt = refusal
          ? { status: 'rejected', ...refusal }
          : { status: 'accepted', externalRef: `DOC-${effectId}` };
        await writeFile(join(receipts, `${effectId}.json`), JSON.stringify(receipt));
      }
      if (archive && !refusal) await rename(join(drop, name), join(archive, name));
      else await rm(join(drop, name));
    }
  }
}
