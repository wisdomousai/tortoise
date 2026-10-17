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
/** A started worker: its piped streams and the way to stop its process tree. */
export interface WorkerProcess {
  readonly child: {
    readonly stdin: NodeJS.WritableStream;
    readonly stdout: NodeJS.ReadableStream;
    readonly stderr: NodeJS.ReadableStream;
    on(event: 'exit', listener: (code: number | null) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
  };
  terminate(): void;
}

export interface WorkerExtractorOptions {
  readonly id: string;
  readonly modality: Extractor['modality'];
  /**
   * Start the worker process. A host passes its process port's start for the declared
   * `perception-worker` process, so the site policy decides the executable and the process
   * plugin builds its environment. Called again after the worker exits.
   */
  readonly start: () => Promise<WorkerProcess>;
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

interface Pending {
  readonly resolve: (line: unknown) => void;
  readonly reject: (error: Error) => void;
}

/** One extractor's process lifetime: the child, its handshake and the requests awaiting answers. */
interface WorkerState {
  readonly options: WorkerExtractorOptions;
  child?: WorkerProcess;
  starting?: Promise<void>;
  /** The last identity a worker reported, kept for readers across restarts. */
  model?: ModelIdentity;
  sequence: number;
  readonly waiting: Map<number, Pending>;
}

/**
 * End the current process lifetime. `owner` fences callbacks: a late exit or error from an
 * earlier process must not reject requests or kill the process that replaced it.
 */
function fail(state: WorkerState, error: Error, owner?: WorkerProcess) {
  if (owner && owner !== state.child) return;
  for (const pending of state.waiting.values()) pending.reject(error);
  state.waiting.clear();
  state.child?.terminate();
  state.child = undefined;
  state.starting = undefined;
}

/** Route stdout lines: the first valid `ready` completes the handshake, later lines answer ids. */
function readLines(state: WorkerState, worker: WorkerProcess, onReady: () => void) {
  // The handshake belongs to this process; `model` keeps the last identity for readers.
  let greeted = false;
  createInterface({ input: worker.child.stdout }).on('line', (line) => {
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
        state.model = hello.data.model;
        onReady();
      }
      return;
    }
    const id = (message as { id?: unknown }).id;
    if (typeof id === 'number') state.waiting.get(id)?.resolve(message);
  });
}

/** Start the worker once per lifetime; resolves on its handshake. */
function start(state: WorkerState): Promise<void> {
  state.starting ??= launch(state);
  return state.starting;
}

/** One process lifetime: start it, then wait for its `ready` line, an exit or the timeout. */
async function launch(state: WorkerState): Promise<void> {
  const { options } = state;
  let worker: WorkerProcess;
  try {
    worker = await options.start();
  } catch (error) {
    state.starting = undefined;
    throw error;
  }
  state.child = worker;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => (
        reject(new Error(`Worker ${options.id} did not become ready`)),
        fail(state, new Error('Worker startup timed out'), worker)
      ),
      options.startupTimeoutMs ?? 30_000,
    );
    worker.child.on(
      'error',
      (error) => (clearTimeout(timer), reject(error), fail(state, error, worker)),
    );
    worker.child.on('exit', (code) => {
      const error = new Error(`Worker ${options.id} exited (${code ?? 'signal'})`);
      clearTimeout(timer);
      reject(error);
      fail(state, error, worker);
    });
    // Worker diagnostics stay local; they may contain paths or model output.
    worker.child.stderr.resume();
    readLines(state, worker, () => (clearTimeout(timer), resolve()));
  });
}

/** Send one extract request and wait for its answer, a timeout or cancellation. */
function request(
  state: WorkerState,
  frame: Parameters<Extractor['extract']>[0],
  fields: Parameters<Extractor['extract']>[1],
  signal: AbortSignal,
) {
  const { options } = state;
  const id = ++state.sequence;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.waiting.delete(id);
      reject(new Error(`Worker ${options.id} timed out`));
    }, options.requestTimeoutMs ?? 30_000);
    const settle = (fn: () => void) => (clearTimeout(timer), state.waiting.delete(id), fn());
    state.waiting.set(id, {
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
    state.child!.child.stdin.write(
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
}

export function createWorkerExtractor(options: WorkerExtractorOptions): Extractor & {
  close(): Promise<void>;
} {
  const state: WorkerState = { options, sequence: 0, waiting: new Map() };
  return {
    id: options.id,
    modality: options.modality,
    get model() {
      return state.model;
    },
    async extract(frame, fields, signal) {
      if (fields.length === 0) return [];
      await start(state);
      const answer = await request(state, frame, fields, signal);
      const parsed = response.parse(answer);
      if ('error' in parsed) throw new Error(`Worker ${options.id}: ${parsed.error}`);
      const wanted = new Set(fields.map((field) => field.id));
      return parsed.readings.filter((reading) => wanted.has(reading.field));
    },
    async close() {
      const worker = state.child;
      worker?.child.stdin.end();
      fail(state, new Error('Worker closed'));
    },
  };
}
