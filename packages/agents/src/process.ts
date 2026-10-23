import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** Terminate only a process group created by this host. POSIX detached children
 * receive an isolated group; Windows uses the OS taskkill tree operation by its
 * absolute system path, never developer PATH. No stale PID files are involved. */
export function terminateProcessTree(child: ChildProcessWithoutNullStreams, force = false) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (!systemRoot) {
      child.kill();
      return;
    }
    const killer = spawn(
      join(systemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    killer.on('error', () => child.kill());
  } else {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}

/** Explicit child environment: provider credentials are supplied by the host, never
 * inherited from developer login files or ambient provider environment variables. */
export function nativeEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}
export async function executableAvailable(executable: string) {
  if (!isAbsolute(executable))
    return { available: false, reason: 'Native executable must be an absolute packaged path' };
  try {
    await access(executable);
    return { available: true };
  } catch {
    return { available: false, reason: 'Packaged native executable is missing or inaccessible' };
  }
}
export type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};
export function protocolRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Malformed native ${name}`);
  return value as Record<string, unknown>;
}
function rpcMessage(value: unknown): RpcMessage {
  const record = protocolRecord(value, 'JSON-RPC message');
  if (record.id !== undefined && typeof record.id !== 'string' && typeof record.id !== 'number')
    throw new Error('Malformed native JSON-RPC ID');
  if (typeof record.id === 'number' && !Number.isSafeInteger(record.id))
    throw new Error('Malformed native JSON-RPC ID');
  if (record.method !== undefined && typeof record.method !== 'string')
    throw new Error('Malformed native JSON-RPC method');
  if (record.id === undefined && record.method === undefined)
    throw new Error('Native JSON-RPC message has no method or ID');
  let error: RpcMessage['error'];
  if (record.error !== undefined) {
    const raw = protocolRecord(record.error, 'JSON-RPC error');
    if (
      (raw.code !== undefined && typeof raw.code !== 'number') ||
      (raw.message !== undefined && typeof raw.message !== 'string')
    )
      throw new Error('Malformed native JSON-RPC error');
    error = { code: raw.code, message: raw.message };
  }
  return {
    id: record.id,
    method: record.method,
    params: record.params,
    result: record.result,
    error,
  };
}

/** Line-delimited app-server JSON-RPC, bounded input and request lifetimes. Native
 * process exit fails all pending requests, including a partial final JSON line. */
export class StdioJsonRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private failure?: Error;
  private stderr = '';
  onMessage?: (message: RpcMessage) => void;
  onFailure?: (error: Error) => void;
  constructor(options: {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs?: number;
    spawn?: () => ChildProcessWithoutNullStreams;
  }) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.child =
      options.spawn?.() ??
      spawn(options.executable, options.args, {
        cwd: options.cwd,
        env: nativeEnvironment(options.env),
        stdio: 'pipe',
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 1_048_576) {
        this.fail(new Error('Native protocol line exceeded 1 MiB'));
        return;
      }
      let index: number;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const message = rpcMessage(JSON.parse(line));
          if (typeof message.id === 'number' && !message.method && this.pending.has(message.id)) {
            const request = this.pending.get(message.id)!;
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            message.error
              ? request.reject(new Error(message.error.message ?? 'Native RPC failed'))
              : request.resolve(message.result);
          } else this.onMessage?.(message);
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error('Malformed native protocol'));
        }
      }
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8_000);
    });
    this.child.on('error', (error) => this.fail(error));
    // A write to a child that has exited emits EPIPE on the stream as well as to the write
    // callback; unhandled, it would crash the host. After close it is expected and ignored.
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('exit', (code, signal) => {
      if (!this.closed)
        this.fail(
          new Error(`Native process exited before completion (${code ?? signal ?? 'unknown'})`),
        );
    });
  }
  private readonly timeoutMs: number;
  private send(message: RpcMessage) {
    if (this.closed) throw this.failure ?? new Error('Native protocol is closed');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > 1_048_576)
      throw new Error('Native protocol request exceeded 1 MiB');
    this.child.stdin.write(line, (error) => {
      if (error) this.fail(error);
    });
  }
  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native RPC timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method: string, params?: unknown) {
    this.send({ method, params });
  }
  respond(id: number | string, result: unknown) {
    this.send({ id, result });
  }
  reject(id: number | string, message: string) {
    this.send({ id, error: { code: -32601, message } });
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.failure = error;
    this.onFailure?.(error);
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.failure ?? new Error('Native process closed'));
    }
    this.pending.clear();
    this.child.stdin.end();
    // On POSIX, the isolated group may still contain descendants after its leader
    // exits. The immediate group termination also covers that failure path.
    if (this.child.exitCode === null || process.platform !== 'win32') {
      terminateProcessTree(this.child);
      const timer = setTimeout(() => {
        if (this.child.exitCode === null) terminateProcessTree(this.child, true);
      }, 1_000);
      timer.unref();
    }
  }
}

/** Internal bounded channel used to combine native callbacks with async generators. */
export class AsyncChannel<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiter?: { resolve(value: IteratorResult<T>): void; reject(error: Error): void };
  private finished = false;
  private error?: Error;
  push(value: T) {
    if (this.finished) return;
    if (this.waiter) {
      this.waiter.resolve({ value, done: false });
      this.waiter = undefined;
    } else if (this.values.length >= 256)
      this.end(new Error('Provider event buffer exceeded limit'));
    else this.values.push(value);
  }
  end(error?: Error) {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    if (this.waiter) {
      error ? this.waiter.reject(error) : this.waiter.resolve({ done: true, value: undefined });
      this.waiter = undefined;
    }
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.values.length) {
        yield this.values.shift()!;
        continue;
      }
      if (this.error) throw this.error;
      if (this.finished) return;
      const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiter = { resolve, reject };
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
