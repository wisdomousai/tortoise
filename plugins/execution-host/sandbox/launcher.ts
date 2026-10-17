/**
 * The first process inside every sandbox. Bubblewrap starts it with the run's launch file; it
 *
 * 1. opens a TCP listener on 127.0.0.1 for each relay, forwarding every connection to the unix
 *    socket the host relays to its own API or to the egress proxy (the sandbox has no other
 *    network);
 * 2. lowers its resource limits, which the task inherits;
 * 3. starts the task with the sandbox's stdio and exits with its status.
 *
 * When it exits, bubblewrap's init ends the PID namespace, so nothing the task left running
 * survives. It imports only Node built-ins and `bun:ffi`, because nothing else is mounted.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';

interface Launch {
  readonly relays: readonly { readonly port: number; readonly socket: string }[];
  readonly limits: Readonly<Record<string, number>>;
  readonly command: readonly [string, ...string[]];
}

const launch = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Launch;

function fail(message: string): never {
  process.stderr.write(`sandbox: ${message}\n`);
  process.exit(125);
}

function relay(port: number, socket: string): Promise<Server> {
  const server = createServer((client: Socket) => {
    const upstream = connect(socket);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Resource numbers from include/uapi/asm-generic/resource.h; the same on x86-64 and arm64.
const resources: Record<string, number> = {
  cpuSeconds: 0,
  fileBytes: 1,
  coreBytes: 4,
  processes: 6,
  openFiles: 7,
};

async function limit(limits: Readonly<Record<string, number>>) {
  const entries = Object.entries({ coreBytes: 0, ...limits });
  const { dlopen, FFIType, ptr } = await import('bun:ffi');
  // glibc, then musl, by the names their dynamic loaders resolve.
  const names = ['libc.so.6', `libc.musl-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}.so.1`];
  const symbols = {
    setrlimit: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  } as const;
  let libc: ReturnType<typeof dlopen<typeof symbols>> | undefined;
  for (const name of names) {
    try {
      libc = dlopen(name, symbols);
      break;
    } catch {
      // Try the next C library.
    }
  }
  if (!libc) fail('resource limits need a C library the sandbox can load');
  for (const [name, value] of entries) {
    const resource = resources[name];
    if (resource === undefined) fail(`unknown limit ${name}`);
    const pair = new BigUint64Array([BigInt(value), BigInt(value)]);
    if (libc.symbols.setrlimit(resource, ptr(pair)) !== 0) fail(`could not set limit ${name}`);
  }
}

const servers = await Promise.all(launch.relays.map((item) => relay(item.port, item.socket)));
await limit(launch.limits);
const [file, ...args] = launch.command;
const task = spawn(file, args, { stdio: 'inherit', env: process.env });
task.once('error', (error) => fail(`could not start ${file}: ${error.message}`));
task.once('exit', (code, signal) => {
  for (const server of servers) server.close();
  const signals: Record<string, number> = { SIGKILL: 9, SIGTERM: 15, SIGSEGV: 11, SIGABRT: 6 };
  process.exit(code ?? 128 + (signal ? (signals[signal] ?? 1) : 1));
});
