import { StringDecoder } from 'node:string_decoder';

/** Why a driver refused or failed a request, from the error's `data.kind`. */
export type DriverErrorKind = 'rejected' | 'precondition' | 'transient' | 'uncertain' | 'refused';

/**
 * A request that did not produce a result. `kind` is the driver's own classification, or
 * `exited` when the process ended with the request in flight, `timeout` when the deadline passed
 * and `protocol` when the response was malformed. `code` is a driver-supplied business code for a
 * rejection.
 */
export class DriverError extends Error {
  constructor(
    readonly kind: DriverErrorKind | 'exited' | 'timeout' | 'cancelled' | 'protocol',
    message: string,
    readonly code?: string,
  ) {
    super(message.slice(0, 500));
    this.name = 'DriverError';
  }
}

/** The error object a driver puts on the wire: JSON-RPC's, with the kind in `data`. */
export interface WireError {
  readonly code: number;
  readonly message: string;
  readonly data?: { readonly kind?: DriverErrorKind; readonly code?: string };
}

const driverKinds = new Set<string>([
  'rejected',
  'precondition',
  'transient',
  'uncertain',
  'refused',
]);
/** A wire error as a `DriverError`. An unclassified error is transient: the driver could not act. */
export function fromWire(error: WireError): DriverError {
  const kind = error.data?.kind;
  return new DriverError(
    kind && driverKinds.has(kind) ? kind : 'transient',
    String(error.message ?? 'Driver error'),
    typeof error.data?.code === 'string' ? error.data.code.slice(0, 64) : undefined,
  );
}

export interface RpcStreams {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

/** A longer line is dropped as malformed, so a driver cannot grow the host's memory without bound. */
export const maxLineLength = 1 << 20;

/**
 * Newline-delimited lines from a stream, each at most `maxLineLength` characters. The rest of an
 * oversized line is skipped up to its newline and reported once through `onOverflow`.
 */
function readLines(
  input: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  onOverflow: () => void,
) {
  const decoder = new StringDecoder('utf8');
  let buffered = '';
  let skipping = false;
  const emit = (line: string) => onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  input.on('data', (chunk: Buffer | string) => {
    let text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    for (let newline = text.indexOf('\n'); newline !== -1; newline = text.indexOf('\n')) {
      const line = buffered + text.slice(0, newline);
      text = text.slice(newline + 1);
      buffered = '';
      if (skipping) skipping = false;
      else if (line.length > maxLineLength) onOverflow();
      else emit(line);
    }
    if (skipping) return;
    buffered += text;
    if (buffered.length > maxLineLength) {
      buffered = '';
      skipping = true;
      onOverflow();
    }
  });
  input.on('end', () => {
    const rest = buffered + decoder.end();
    if (!skipping && rest) emit(rest);
  });
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: DriverError): void;
}

/**
 * JSON-RPC 2.0 over newline-delimited JSON. One request per line, replied to by id; notifications
 * have no id. Aborting a request sends `$/cancel` and rejects it at once; a late response is
 * dropped. A line that is not a JSON-RPC message, or is longer than `maxLineLength`, goes to
 * `onMalformed`, never to a caller.
 * `close` rejects everything in flight with the given error.
 */
export function createRpcConnection(
  streams: RpcStreams,
  handlers: {
    onNotification(method: string, params: unknown): void;
    onMalformed(line: string): void;
  },
) {
  let nextId = 1;
  let closed: DriverError | undefined;
  const pending = new Map<number, Pending>();
  const write = (message: object) =>
    streams.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

  readLines(streams.input, receive, () =>
    handlers.onMalformed(`A line longer than ${maxLineLength} characters`),
  );

  function receive(line: string) {
    let message: {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: WireError;
    };
    try {
      message = JSON.parse(line);
    } catch {
      return handlers.onMalformed(line);
    }
    if (typeof message.method === 'string' && message.id === undefined)
      return handlers.onNotification(message.method, message.params);
    const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined;
    if (!waiting) return handlers.onMalformed(line);
    pending.delete(message.id as number);
    if (message.error) waiting.reject(fromWire(message.error));
    else waiting.resolve(message.result);
  }

  function request<T>(method: string, params: unknown, options: RequestOptions): Promise<T> {
    if (closed) return Promise.reject(closed);
    if (options.signal?.aborted)
      return Promise.reject(new DriverError('cancelled', `${method} was cancelled`));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const complete = () => (
        clearTimeout(timer),
        options.signal?.removeEventListener('abort', cancel)
      );
      const cancel = () => {
        pending.delete(id);
        complete();
        write({ method: '$/cancel', params: { id } });
        reject(new DriverError('cancelled', `${method} was cancelled`));
      };
      const timer = setTimeout(() => {
        pending.delete(id);
        complete();
        write({ method: '$/cancel', params: { id } });
        reject(new DriverError('timeout', `${method} did not respond in time`));
      }, options.timeoutMs);
      options.signal?.addEventListener('abort', cancel, { once: true });
      pending.set(id, {
        resolve: (value) => (complete(), resolve(value as T)),
        reject: (error) => (complete(), reject(error)),
      });
      write({ id, method, params });
    });
  }

  return {
    request,
    notify: (method: string, params: unknown) => void (closed || write({ method, params })),
    close(error: DriverError) {
      closed ??= error;
      for (const waiting of pending.values()) waiting.reject(error);
      pending.clear();
    },
  };
}
export type RpcConnection = ReturnType<typeof createRpcConnection>;
