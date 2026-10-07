import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { Extractor, ModelIdentity } from '../ports';

/**
 * JSON-lines protocol for local perception runtimes (OCR engines, classifiers, vision or audio
 * models in Python, ONNX Runtime, llama.cpp, whatever the site runs). One process, one model:
 *
 * - On start the worker prints `{"type":"ready","model":{"id","version","digest"}}`.
 * - The bridge writes `{"id":n,"type":"extract","modality","width","height","image","fields"}`
 *   per frame; `image` is base64 PNG (or null), `fields` the requested `ExtractionField`s.
 * - The worker answers `{"id":n,"readings":[{"field","value","confidence"}]}` or
 *   `{"id":n,"error":"text"}`. Readings for fields that were not requested are ignored.
 *
 * Audio models use the same protocol with `modality: "audio"`; the frame then carries the clip
 * reference in a field hint. The model identity the worker reports is recorded with every reading.
 */
export interface WorkerExtractorOptions {
  readonly id: string;
  readonly modality: Extractor['modality'];
  /** Executable and arguments. Configured explicitly; never discovered. */
  readonly command: readonly [string, ...string[]];
  readonly cwd?: string;
  /** The worker's whole environment. Nothing is inherited, so host credentials never leak in. */
  readonly env?: Readonly<Record<string, string>>;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

const ready = z.object({
  type: z.literal('ready'),
  model: z.object({
    id: z.string().min(1).max(200),
    version: z.string().max(100).optional(),
    digest: z.string().max(200).optional(),
  }),
});
const response = z.union([
  z.object({
    id: z.number().int(),
    readings: z.array(
      z.object({
        field: z.string().max(64),
        value: z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]),
        confidence: z.number().min(0).max(1),
      }),
    ),
  }),
  z.object({ id: z.number().int(), error: z.string().max(1_000) }),
]);

export function createWorkerExtractor(options: WorkerExtractorOptions): Extractor & {
  close(): Promise<void>;
} {
  let child: ChildProcessWithoutNullStreams | undefined;
  let starting: Promise<void> | undefined;
  let model: ModelIdentity | undefined;
  let sequence = 0;
  const waiting = new Map<
    number,
    { resolve: (line: unknown) => void; reject: (error: Error) => void }
  >();

  /**
   * End the current process lifetime. `owner` fences callbacks: a late exit or error from an
   * earlier process must not reject requests or kill the process that replaced it.
   */
  function fail(error: Error, owner?: ChildProcessWithoutNullStreams) {
    if (owner && owner !== child) return;
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
    child?.kill();
    child = undefined;
    starting = undefined;
  }

  function start(): Promise<void> {
    starting ??= new Promise<void>((resolve, reject) => {
      const [command, ...args] = options.command;
      const process = spawn(command, args, {
        cwd: options.cwd,
        env: { ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child = process;
      // The handshake belongs to this process; `model` keeps the last identity for readers.
      let greeted = false;
      const timer = setTimeout(
        () => (
          reject(new Error(`Worker ${options.id} did not become ready`)),
          fail(new Error('Worker startup timed out'), process)
        ),
        options.startupTimeoutMs ?? 30_000,
      );
      process.on('error', (error) => (clearTimeout(timer), reject(error), fail(error, process)));
      process.on('exit', (code) =>
        fail(new Error(`Worker ${options.id} exited (${code ?? 'signal'})`), process),
      );
      // Worker diagnostics stay local; they may contain paths or model output.
      process.stderr.resume();
      createInterface({ input: process.stdout }).on('line', (line) => {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!greeted) {
          const hello = ready.safeParse(message);
          if (hello.success) {
            greeted = true;
            model = hello.data.model;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        const id = (message as { id?: unknown }).id;
        if (typeof id === 'number') waiting.get(id)?.resolve(message);
      });
    });
    return starting;
  }

  return {
    id: options.id,
    modality: options.modality,
    get model() {
      return model;
    },
    async extract(frame, fields, signal) {
      if (fields.length === 0) return [];
      await start();
      const id = ++sequence;
      const answer = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`Worker ${options.id} timed out`));
        }, options.requestTimeoutMs ?? 30_000);
        const settle = (fn: () => void) => (clearTimeout(timer), waiting.delete(id), fn());
        waiting.set(id, {
          resolve: (line) => settle(() => resolve(line)),
          reject: (error) => settle(() => reject(error)),
        });
        signal.addEventListener(
          'abort',
          () => settle(() => reject(new Error('Extraction cancelled'))),
          {
            once: true,
          },
        );
        child!.stdin.write(
          `${JSON.stringify({
            id,
            type: 'extract',
            modality: options.modality,
            width: frame.width,
            height: frame.height,
            image: frame.image ? Buffer.from(frame.image).toString('base64') : null,
            fields,
          })}\n`,
        );
      });
      const parsed = response.parse(answer);
      if ('error' in parsed) throw new Error(`Worker ${options.id}: ${parsed.error}`);
      const wanted = new Set(fields.map((field) => field.id));
      return parsed.readings.filter((reading) => wanted.has(reading.field));
    },
    async close() {
      const process = child;
      fail(new Error('Worker closed'));
      process?.stdin.end();
    },
  };
}
