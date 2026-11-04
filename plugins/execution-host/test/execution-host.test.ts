import { describe, expect, test } from 'bun:test';
import { collectRequirements, defineHostComponent } from '@tortoise/contracts';
import { createBroker } from '../src/broker';
import {
  bwrapArguments,
  bwrapCommand,
  encodeArguments,
  sandboxPaths,
  toolPath,
  type HostEntry,
} from '../src/bwrap';
import { executionSandbox } from '../src/contracts';
import { resolveLimits } from '../src/limits';
import {
  CLONE_NAMESPACE_FLAGS,
  deniedSyscalls,
  seccompFilter,
  seccompProgram,
} from '../src/seccomp';

/** Run a classic BPF program over one syscall, as the kernel's seccomp evaluator does. */
function evaluate(arch: 'x64' | 'arm64', data: { nr: number; arch: number; arg0?: number }) {
  const program = seccompProgram(arch);
  let accumulator = 0;
  for (let pc = 0; pc < program.length; pc++) {
    const [code, jt, jf, k] = program[pc]!;
    if (code === 0x20)
      accumulator = k === 0 ? data.nr : k === 4 ? data.arch : k === 16 ? (data.arg0 ?? 0) : NaN;
    else if (code === 0x06) return k >>> 0;
    else {
      const hit =
        code === 0x15
          ? accumulator === k
          : code === 0x35
            ? accumulator >= k
            : (accumulator & k) !== 0;
      pc += hit ? jt : jf;
    }
  }
  throw new Error('Program fell off its end');
}
const ALLOW = 0x7fff0000;
const KILL = 0x80000000;
const EPERM = 0x00050001;
const ENOSYS = 0x00050026;
const X64 = 0xc000003e;
const ARM64 = 0xc00000b7;

describe('seccomp filter', () => {
  test('denies the listed calls with EPERM and allows ordinary ones', () => {
    // x86-64: mount 165, unshare 272, ptrace 101, bpf 321; read 0, openat 257, write 1.
    for (const nr of [165, 272, 101, 321, 425])
      expect(evaluate('x64', { nr, arch: X64 })).toBe(EPERM);
    for (const nr of [0, 1, 257, 59]) expect(evaluate('x64', { nr, arch: X64 })).toBe(ALLOW);
    // arm64: mount 40, unshare 97, ptrace 117; read 63, openat 56, execve 221.
    for (const nr of [40, 97, 117, 280]) expect(evaluate('arm64', { nr, arch: ARM64 })).toBe(EPERM);
    for (const nr of [63, 56, 221]) expect(evaluate('arm64', { nr, arch: ARM64 })).toBe(ALLOW);
  });

  test('clone with a namespace flag is denied, plain clone allowed, clone3 reports ENOSYS', () => {
    expect(evaluate('x64', { nr: 56, arch: X64, arg0: 0x11 })).toBe(ALLOW);
    expect(evaluate('x64', { nr: 56, arch: X64, arg0: 0x10000000 })).toBe(EPERM);
    expect(evaluate('arm64', { nr: 220, arch: ARM64, arg0: CLONE_NAMESPACE_FLAGS })).toBe(EPERM);
    expect(evaluate('x64', { nr: 435, arch: X64 })).toBe(ENOSYS);
  });

  test('another architecture and the x32 ABI are killed', () => {
    expect(evaluate('x64', { nr: 0, arch: ARM64 })).toBe(KILL);
    expect(evaluate('arm64', { nr: 63, arch: X64 })).toBe(KILL);
    expect(evaluate('x64', { nr: 0x40000000, arch: X64 })).toBe(KILL);
  });

  test('encodes eight little-endian bytes per instruction, every call numbered on both', () => {
    const program = seccompProgram('arm64');
    const bytes = seccompFilter('arm64');
    expect(bytes.length).toBe(program.length * 8);
    const view = new DataView(bytes.buffer);
    expect([view.getUint16(8, true), view.getUint32(12, true)]).toEqual([0x15, ARM64]);
    // Every denied call has a number on both architectures, so none is silently skipped.
    for (const arch of ['x64', 'arm64'] as const) {
      const checked = seccompProgram(arch).filter(([code]) => code === 0x15).length;
      expect(checked).toBe(1 + deniedSyscalls.length + 2);
    }
  });
});

describe('bubblewrap layout', () => {
  const system = new Map<string, HostEntry>([
    ['/lib', { kind: 'symlink', target: 'usr/lib' }],
    ['/usr/lib', { kind: 'directory' }],
    ['/etc/ld.so.cache', { kind: 'file' }],
    ['/lib64', { kind: 'missing' }],
  ]);
  const args = bwrapArguments({
    runtime: '/usr/local/bin/bun',
    tools: ['/usr/local/bin/bun', '/usr/bin/git'],
    readOnly: ['/srv/checkout'],
    workdir: '/srv/task',
    sockets: '/tmp/run/sock',
    env: { PATH: '/usr/local/bin:/usr/bin', HTTPS_PROXY: 'http://sandbox:secret@127.0.0.1:1' },
    system,
  });
  const pairs = (flag: string) =>
    args.flatMap((arg, index) => (arg === flag ? [args.slice(index + 1, index + 3)] : []));

  test('unshares every namespace, drops capabilities and forbids nested user namespaces', () => {
    for (const flag of [
      '--unshare-all',
      '--unshare-user',
      '--disable-userns',
      '--die-with-parent',
      '--new-session',
      '--clearenv',
    ])
      expect(args).toContain(flag);
    expect(args.slice(args.indexOf('--cap-drop'), args.indexOf('--cap-drop') + 2)).toEqual([
      '--cap-drop',
      'ALL',
    ]);
    expect(args).not.toContain('--share-net');
  });

  test('mounts libraries, the tools and the named paths, not the host root or its binaries', () => {
    expect(pairs('--ro-bind')).toEqual(
      expect.arrayContaining([
        ['/usr/lib', '/usr/lib'],
        ['/usr/local/bin/bun', '/usr/local/bin/bun'],
        ['/usr/bin/git', '/usr/bin/git'],
        ['/srv/checkout', '/srv/checkout'],
        ['/tmp/run/sock', sandboxPaths.sockets],
      ]),
    );
    expect(pairs('--ro-bind').map(([source]) => source)).not.toContain('/');
    expect(pairs('--ro-bind').map(([source]) => source)).not.toContain('/usr/bin');
    expect(pairs('--symlink')).toContainEqual(['usr/lib', '/lib']);
    expect(pairs('--bind')).toEqual([['/srv/task', sandboxPaths.work]]);
    expect(args.join(' ')).not.toContain('/lib64');
  });

  test('passes the launcher, launch file, connection and filter by descriptor, then runs the launcher', () => {
    expect(pairs('--file')).toEqual([
      ['5', sandboxPaths.launcher],
      ['6', sandboxPaths.launch],
      ['7', sandboxPaths.connection],
    ]);
    expect(args.slice(args.indexOf('--seccomp'), args.indexOf('--seccomp') + 2)).toEqual([
      '--seccomp',
      '4',
    ]);
    expect(args.at(-1)).toBe('4');
    expect(bwrapCommand('/usr/local/bin/bun')).toEqual([
      '--args',
      '3',
      '--',
      '/usr/local/bin/bun',
      sandboxPaths.launcher,
      sandboxPaths.launch,
    ]);
    expect(new TextDecoder().decode(encodeArguments(['a', 'b']))).toBe('a\0b\0');
    expect(toolPath(['/usr/local/bin/bun', '/usr/bin/git', '/usr/bin/rg'])).toBe(
      '/usr/local/bin:/usr/bin',
    );
  });
});

describe('broker', () => {
  const context = {
    workspaceId: 'local',
    principalId: 'ann',
    runId: 'r1',
    grant: { operations: ['note.list'], expiresAt: 10_000 },
  };

  test('a token stands for the run-bound context until it is revoked or ends', () => {
    let now = 1_000;
    const broker = createBroker(() => now);
    const issued = broker.issue(context, 5_000);
    expect(broker.authenticate(issued.token)).toEqual({
      workspaceId: 'local',
      principalId: 'ann',
      runId: 'r1',
      grant: {
        operations: ['note.list'],
        expiresAt: 5_000,
        principalId: 'ann',
        workspaceId: 'local',
        runId: 'r1',
      },
    });
    expect(broker.authenticate('guess')).toBeUndefined();
    now = 5_000;
    expect(broker.authenticate(issued.token)).toBeUndefined();
    now = 1_000;
    const second = broker.issue(context, 5_000);
    broker.revoke(second.token);
    expect(broker.authenticate(second.token)).toBeUndefined();
    expect(broker.size()).toBe(0);
  });

  test('refuses a context without a grant or with an expired one', () => {
    const broker = createBroker(() => 20_000);
    expect(() => broker.issue({ workspaceId: 'local', principalId: 'ann' }, 30_000)).toThrow(
      'delegation grant',
    );
    expect(() => broker.issue(context, 30_000)).toThrow('Delegation expired');
  });
});

test('a sandbox is a declared bwrap process with its own destinations', () => {
  const modelApi = defineHostComponent({
    id: 'model-api',
    description: 'Model API',
    requirements: {
      network: [
        {
          id: 'model-api',
          purpose: 'Model calls',
          direction: 'outbound',
          scope: 'internet',
          protocol: 'https',
          dataClasses: ['prompts'],
          availability: 'optional',
          offline: 'degrade',
        },
      ],
    },
  });
  const requirements = collectRequirements([
    modelApi,
    executionSandbox({ id: 'tools', description: 'Agent tools', network: ['model-api'] }),
  ]);
  expect(requirements.processes).toEqual([
    expect.objectContaining({ id: 'tools', executable: 'bwrap', network: ['model-api'] }),
  ]);
  expect(() => resolveLimits({ wallMs: 0 })).toThrow('positive integer');
  expect(resolveLimits({ outputBytes: 10 }).outputBytes).toBe(10);
});
