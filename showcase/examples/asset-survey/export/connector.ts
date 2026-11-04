import { createInterface } from 'node:readline';
import type { BlobRef } from '@tortoise/contracts';
import type { SpawnedProcess } from '@tortoise/host/plugin';
import { DeliveryFailure, type SystemOfRecordPort } from '@tortoise/integration';
import type { Effect, EffectOutcome } from '@tortoise/runtime';
import type { EvidenceReader } from '../connectors/fake-eam';
import { exportResultSchema, type ExportRequest } from './protocol';

export interface ExportPortOptions {
  /** Start the declared `filing-export` process; the site policy decides what runs. */
  readonly start: (signal: AbortSignal) => Promise<SpawnedProcess>;
  readonly readBlob: EvidenceReader;
  readonly timeoutMs?: number;
}

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/** `=G1-Q1` and filing `f7` become `G1-Q1_f7`: readable in a file browser, unique per filing. */
export function exportFolder(designation: string, filingId: string): string {
  const slug = designation
    .replace(/[^A-Za-z0-9.+-]+/g, '_')
    .replace(/^[^A-Za-z0-9]+|_+$/g, '')
    .slice(0, 96);
  return slug ? `${slug}_${filingId}` : filingId;
}

async function request(effect: Readonly<Effect>, readBlob: EvidenceReader): Promise<ExportRequest> {
  const { photos, ...record } = effect.payload as unknown as {
    designation: string;
    photos: BlobRef[];
  } & Record<string, unknown>;
  const files = [];
  for (const photo of photos) {
    const blob = await readBlob(effect, photo.digest);
    // A photo that cannot be read now is transient: the hub still holds it.
    if (!blob) throw new DeliveryFailure('An evidence photo could not be read');
    files.push({
      file: `photos/${photo.digest.slice('sha256:'.length)}.${extensions[photo.mediaType] ?? 'bin'}`,
      digest: photo.digest,
      mediaType: photo.mediaType,
      data: Buffer.from(blob.data).toString('base64'),
    });
  }
  const filingId = effect.resource.slice('filing:'.length);
  return {
    id: effect.id,
    folder: exportFolder(record.designation, filingId),
    record: {
      filingId,
      ...record,
      photos: files.map(({ file, digest, mediaType }) => ({ file, digest, mediaType })),
    },
    photos: files.map(({ file, digest, data }) => ({ file, digest, data })),
  };
}

/**
 * The first line the process prints before closing its output. Reading to the end, not to the
 * exit event, keeps a result printed just before exiting.
 */
function readResult(
  worker: SpawnedProcess,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let first: string | undefined;
    const fail = (message: string) => () => (
      clearTimeout(timer),
      reject(new DeliveryFailure(message))
    );
    const timer = setTimeout(fail('The export process did not respond in time'), timeoutMs);
    signal.addEventListener('abort', fail('The export was cancelled'), { once: true });
    worker.child.once('error', fail('The export process failed'));
    // Its diagnostics stay local; they may contain paths.
    worker.child.stderr.resume();
    createInterface({ input: worker.child.stdout })
      .on('line', (line) => (first ??= line))
      .once('close', () =>
        first === undefined
          ? fail('The export process exited without a result')()
          : (clearTimeout(timer), resolve(first)),
      );
  });
}

/**
 * The export directory as a system of record. Each delivery starts the `filing-export` process,
 * hands it the filing and its photos, and accepts once the process returns the folder it
 * wrote; the folder name is the external reference. Everything else (the process unbound or
 * unable to start, an error result, no result) leaves the filing pending and retried, since a
 * site fixes its directory rather than the filing. Delivery is idempotent: the process returns
 * a folder that already holds the effect as written.
 */
export function createExportPort(options: ExportPortOptions): SystemOfRecordPort {
  return {
    describe: () => ({ target: 'export', idempotentDelivery: true }),
    async deliver(effect, signal): Promise<EffectOutcome> {
      const message = await request(effect, options.readBlob);
      let worker: SpawnedProcess;
      try {
        worker = await options.start(signal);
      } catch {
        throw new DeliveryFailure('The export process is not available here');
      }
      try {
        worker.child.stdin.end(`${JSON.stringify(message)}\n`);
        const parsed = exportResultSchema.safeParse(
          JSON.parse(await readResult(worker, options.timeoutMs ?? 30_000, signal)),
        );
        if (!parsed.success || parsed.data.id !== effect.id)
          throw new DeliveryFailure('The export process returned something else');
        if ('error' in parsed.data)
          throw new DeliveryFailure('The export directory did not take the filing');
        return { status: 'accepted', externalRef: parsed.data.folder };
      } catch (error) {
        if (error instanceof DeliveryFailure) throw error;
        throw new DeliveryFailure('The export process returned something else');
      } finally {
        worker.terminate();
      }
    },
  };
}
