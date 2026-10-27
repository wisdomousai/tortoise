#!/usr/bin/env bun
/**
 * The reference `filing-export` process. The site policy binds it with the export directory as
 * its last argument, for example `{ "executable": "/usr/local/bin/bun", "args":
 * ["/opt/survey/examples/asset-survey/export/worker.ts", "/srv/survey-export"] }`.
 *
 * It reads one request line from stdin (see `protocol.ts`), writes the folder and returns one
 * line on stdout. The folder is assembled under a hidden temporary name and renamed into place,
 * so an importer never sees half a filing. A folder that already holds the same effect is
 * returned as written, which makes a retried delivery safe.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { exportRequestSchema, type ExportResult } from './protocol';

async function readRequest(): Promise<unknown> {
  const text = await new Response(Bun.stdin.stream()).text();
  return JSON.parse(text.split('\n', 1)[0] ?? '');
}

async function writtenEffect(folder: string): Promise<string | undefined> {
  try {
    return (
      JSON.parse(await readFile(join(folder, 'record.json'), 'utf8')) as { effectId?: string }
    ).effectId;
  } catch {
    return undefined;
  }
}

async function exportFiling(directory: string, raw: unknown): Promise<ExportResult> {
  const request = exportRequestSchema.parse(raw);
  const target = join(directory, request.folder);
  const existing = await writtenEffect(target);
  if (existing === request.id) return { id: request.id, folder: request.folder };
  if (existing !== undefined) return { id: request.id, error: 'The folder holds another filing' };
  const files = request.photos.map((photo) => {
    const data = Buffer.from(photo.data, 'base64');
    // The record names each photo by digest; a photo that does not match it is not written.
    if (`sha256:${createHash('sha256').update(data).digest('hex')}` !== photo.digest)
      throw new Error('A photo does not match its digest');
    return { path: photo.file, data };
  });
  const staging = join(directory, `.${request.folder}.${randomUUID()}.partial`);
  try {
    await mkdir(join(staging, 'photos'), { recursive: true });
    for (const file of files) await writeFile(join(staging, file.path), file.data);
    await writeFile(
      join(staging, 'record.json'),
      `${JSON.stringify({ effectId: request.id, ...request.record }, null, 2)}\n`,
    );
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { id: request.id, folder: request.folder };
}

async function isDirectory(path: string) {
  try {
    return isAbsolute(path) && (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function main(): Promise<ExportResult> {
  const directory = process.argv.length < 3 ? '' : process.argv.at(-1)!;
  if (!(await isDirectory(directory)))
    return { id: '', error: 'The export directory is not an absolute path to a directory' };
  const raw = await readRequest();
  try {
    return await exportFiling(directory, raw);
  } catch (error) {
    const id = (raw as { id?: unknown })?.id;
    return {
      id: typeof id === 'string' ? id : '',
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}

process.stdout.write(`${JSON.stringify(await main())}\n`);
