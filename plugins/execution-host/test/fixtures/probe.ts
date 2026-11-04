// Runs inside a sandbox for the execution host's Linux tests. Each mode tries something and
// prints one JSON line with what happened; the test decides what is allowed.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

const [mode, ...args] = process.argv.slice(2);
const print = (value: unknown) => console.log(JSON.stringify(value));
const attempt = (action: () => unknown) => {
  try {
    return { ok: true, value: action() };
  } catch (error) {
    return { ok: false, code: (error as NodeJS.ErrnoException).code ?? String(error) };
  }
};

/** Whether a TCP connection opens, or the error code. */
function tcp(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(2_000, () => (socket.destroy(), resolve('TIMEOUT')));
    socket.once('connect', () => (socket.destroy(), resolve('OPEN')));
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'ERROR'));
  });
}

/** The status line a CONNECT through the sandbox's proxy returns, and the first bytes after. */
function proxyConnect(target: string): Promise<{ status: string; body?: string }> {
  const proxy = new URL(process.env.HTTPS_PROXY!);
  const auth = Buffer.from(
    `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
  ).toString('base64');
  return new Promise((resolve) => {
    const socket = connect({ host: proxy.hostname, port: Number(proxy.port) });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      const end = data.indexOf('\r\n\r\n');
      if (end < 0) return;
      const status = data.slice(0, data.indexOf('\r\n'));
      const body = data.slice(end + 4);
      if (!status.includes(' 200 ') || body) (socket.destroy(), resolve({ status, body }));
    });
    socket.on('error', (error: NodeJS.ErrnoException) =>
      resolve({ status: error.code ?? 'ERROR' }),
    );
    socket.on('close', () => resolve({ status: data.split('\r\n')[0] ?? '' }));
    socket.write(
      `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`,
    );
  });
}

/** Call libc directly and return the errno, as a tool written in C would see it. */
async function syscalls() {
  const { dlopen, FFIType, read } = await import('bun:ffi');
  const name =
    existsSync('/lib/libc.so.6') || existsSync('/usr/lib/libc.so.6')
      ? 'libc.so.6'
      : `libc.musl-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}.so.1`;
  const libc = dlopen(name, {
    mount: {
      args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    },
    unshare: { args: [FFIType.i32], returns: FFIType.i32 },
    ptrace: { args: [FFIType.i64, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
    chroot: { args: [FFIType.cstring], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  });
  const errno = () => read.i32(libc.symbols.__errno_location()!, 0);
  const cstr = (text: string) => Buffer.from(`${text}\0`);
  const result = (value: number | bigint) => (Number(value) === 0 ? 'OK' : `errno ${errno()}`);
  return {
    mount: result(libc.symbols.mount(cstr('none'), cstr('/tmp'), cstr('tmpfs'), 0, null)),
    unshareUser: result(libc.symbols.unshare(0x10000000)),
    unshareNet: result(libc.symbols.unshare(0x40000000)),
    ptrace: result(libc.symbols.ptrace(0, 0, null, null)),
    chroot: result(libc.symbols.chroot(cstr('/tmp'))),
  };
}

async function api(path: string, body: unknown) {
  const connection = JSON.parse(readFileSync(process.env.TORTOISE_CONNECTION!, 'utf8'));
  const response = await fetch(new URL(path, connection.endpoint), {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

if (mode === 'escape') {
  const [secret, readOnly, hostPort] = args as [string, string, string];
  const fds = readdirSync('/proc/self/fd');
  print({
    uid: process.getuid?.(),
    secret: attempt(() => readFileSync(secret, 'utf8')),
    passwd: existsSync('/etc/passwd'),
    shadow: existsSync('/etc/shadow'),
    home: existsSync('/home') || existsSync('/root'),
    writeReadOnly: attempt(() => writeFileSync(`${readOnly}/planted`, 'x')),
    writeWork: attempt(() => writeFileSync('/work/written', 'x')),
    processes: readdirSync('/proc').filter((name) => /^\d+$/.test(name)).length,
    env: Object.keys(process.env).sort(),
    descriptors: fds.length,
    limits: Object.fromEntries(
      readFileSync('/proc/self/limits', 'utf8')
        .split('\n')
        .filter((line) => /^Max (open files|processes|file size|core file size)/.test(line))
        .map((line) => [line.slice(0, 26).trim(), line.slice(26, 47).trim()]),
    ),
    undeclaredTool: await new Promise((resolve) =>
      spawn('/usr/bin/id', [])
        .once('error', (error: NodeJS.ErrnoException) => resolve(error.code))
        .once('spawn', () => resolve('STARTED')),
    ),
    sockets: readdirSync('/run/tortoise/sock').sort(),
    interfaces: Object.keys(networkInterfaces()),
    external: await tcp('1.1.1.1', 80),
    hostLoopback: await tcp('127.0.0.1', Number(hostPort)),
    syscalls: await syscalls(),
  });
} else if (mode === 'proxy') {
  print({
    declared: await proxyConnect(args[0]!),
    undeclared: await proxyConnect('example.com:443'),
  });
} else if (mode === 'later') {
  // Wait, then call the API, to see a token revoked or expired in between.
  await Bun.sleep(Number(args[0]));
  print(await api('/api/v1/queries/note.list', { input: {} }));
} else if (mode === 'flood') {
  process.stdout.write('x'.repeat(Number(args[0])));
} else if (mode === 'spin') {
  for (;;);
} else if (mode === 'linger') {
  // Leave a child behind that would write after the task exits.
  spawn(
    process.execPath,
    ['-e', 'await Bun.sleep(1000); require("fs").writeFileSync("/work/late", "x")'],
    {
      detached: true,
      stdio: 'ignore',
    },
  ).unref();
  print({ left: true });
} else if (mode === 'cli') {
  // The application CLI attached through the connection file: list, add the granted note, then
  // try one the grant does not cover.
  const cli = (...words: string[]) =>
    new Promise<{ code: number | null; out: unknown }>((resolve) => {
      const child = spawn(process.execPath, [args[0]!, ...words], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.once('exit', (code) => resolve({ code, out: JSON.parse(out) }));
    });
  print({
    list: await cli('note', 'list'),
    add: await cli('note', 'add', '--id', 'c1', '--text', 'by cli'),
    other: await cli('note', 'add', '--id', 'c2', '--text', 'other'),
  });
} else if (mode === 'mcp') {
  // An MCP client in the sandbox, over the attached stdio server, does the same two steps.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [args[0]!],
    env: process.env as Record<string, string>,
  });
  const client = new Client({ name: 'probe', version: '0.0.0' });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const before = await client.callTool({ name: 'note_list', arguments: { input: {} } });
  const added = await client.callTool({
    name: 'note_add',
    arguments: { input: { id: 'm1', text: 'via mcp' }, idempotencyKey: 'm1' },
  });
  const other = await client.callTool({
    name: 'note_add',
    arguments: { input: { id: 'm2', text: 'other' }, idempotencyKey: 'm2' },
  });
  await client.close();
  print({
    tools,
    before: before.structuredContent ?? before.content,
    added: added.isError ?? false,
    other,
  });
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
