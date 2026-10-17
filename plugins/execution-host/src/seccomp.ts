/**
 * The seccomp filter every sandbox runs under, as the classic BPF program bubblewrap's
 * `--seccomp` takes: an array of `struct sock_filter` (8 bytes each, little-endian).
 *
 * It is a deny list on top of the namespaces, not an allow list: the namespaces already decide
 * what a call can reach, and the filter removes the calls that attack the kernel or the namespace
 * setup itself (mounting, new namespaces, ptrace, module and BPF loading, keyrings, io_uring).
 * Denied calls fail with EPERM, so a tool sees an ordinary error. `clone3` fails with ENOSYS, so
 * the C library falls back to `clone`, whose namespace flags the filter can inspect. A program
 * for another architecture, or the x32 ABI on x86-64, is killed.
 */

/** Architectures the filter is built for, by Node's `process.arch` name. */
export type SeccompArch = 'x64' | 'arm64';

const AUDIT_ARCH: Record<SeccompArch, number> = { x64: 0xc000003e, arm64: 0xc00000b7 };
const X32_SYSCALL_BIT = 0x40000000;

const EPERM = 1;
const ENOSYS = 38;

// struct seccomp_data: nr at 0, arch at 4, args[0] (low word on little-endian) at 16.
const OFFSET_NR = 0;
const OFFSET_ARCH = 4;
const OFFSET_ARG0 = 16;

const LD_ABS_W = 0x20;
const JEQ_K = 0x15;
const JGE_K = 0x35;
const JSET_K = 0x45;
const RET_K = 0x06;

const RET_ALLOW = 0x7fff0000;
const RET_KILL_PROCESS = 0x80000000;
const retErrno = (errno: number) => 0x00050000 | errno;

/** CLONE_NEWNS, NEWCGROUP, NEWUTS, NEWIPC, NEWUSER, NEWPID, NEWNET and NEWTIME. */
export const CLONE_NAMESPACE_FLAGS = 0x7e020080;

/** Denied calls by name. Calls one architecture lacks are absent from its table below. */
export const deniedSyscalls = [
  'ptrace',
  'process_vm_readv',
  'process_vm_writev',
  'mount',
  'umount2',
  'pivot_root',
  'chroot',
  'open_tree',
  'move_mount',
  'fsopen',
  'fsconfig',
  'fsmount',
  'fspick',
  'mount_setattr',
  'unshare',
  'setns',
  'swapon',
  'swapoff',
  'reboot',
  'kexec_load',
  'kexec_file_load',
  'init_module',
  'finit_module',
  'delete_module',
  'bpf',
  'perf_event_open',
  'userfaultfd',
  'keyctl',
  'add_key',
  'request_key',
  'open_by_handle_at',
  'acct',
  'quotactl',
  'settimeofday',
  'clock_settime',
  'syslog',
  'vhangup',
  'personality',
  'lookup_dcookie',
  'io_uring_setup',
  'io_uring_enter',
  'io_uring_register',
] as const;
export type DeniedSyscall = (typeof deniedSyscalls)[number];

// From the kernel's arch/x86/entry/syscalls/syscall_64.tbl and include/uapi/asm-generic/unistd.h.
const shared = {
  io_uring_setup: 425,
  io_uring_enter: 426,
  io_uring_register: 427,
  open_tree: 428,
  move_mount: 429,
  fsopen: 430,
  fsconfig: 431,
  fsmount: 432,
  fspick: 433,
  mount_setattr: 442,
} as const;
const numbers: Record<SeccompArch, Record<DeniedSyscall | 'clone' | 'clone3', number>> = {
  x64: {
    ...shared,
    clone: 56,
    clone3: 435,
    ptrace: 101,
    process_vm_readv: 310,
    process_vm_writev: 311,
    mount: 165,
    umount2: 166,
    pivot_root: 155,
    chroot: 161,
    unshare: 272,
    setns: 308,
    swapon: 167,
    swapoff: 168,
    reboot: 169,
    kexec_load: 246,
    kexec_file_load: 320,
    init_module: 175,
    finit_module: 313,
    delete_module: 176,
    bpf: 321,
    perf_event_open: 298,
    userfaultfd: 323,
    keyctl: 250,
    add_key: 248,
    request_key: 249,
    open_by_handle_at: 304,
    acct: 163,
    quotactl: 179,
    settimeofday: 164,
    clock_settime: 227,
    syslog: 103,
    vhangup: 153,
    personality: 135,
    lookup_dcookie: 212,
  },
  arm64: {
    ...shared,
    clone: 220,
    clone3: 435,
    ptrace: 117,
    process_vm_readv: 270,
    process_vm_writev: 271,
    mount: 40,
    umount2: 39,
    pivot_root: 41,
    chroot: 51,
    unshare: 97,
    setns: 268,
    swapon: 224,
    swapoff: 225,
    reboot: 142,
    kexec_load: 104,
    kexec_file_load: 294,
    init_module: 105,
    finit_module: 273,
    delete_module: 106,
    bpf: 280,
    perf_event_open: 241,
    userfaultfd: 282,
    keyctl: 219,
    add_key: 217,
    request_key: 218,
    open_by_handle_at: 265,
    acct: 89,
    quotactl: 60,
    settimeofday: 170,
    clock_settime: 112,
    syslog: 116,
    vhangup: 58,
    personality: 92,
    lookup_dcookie: 18,
  },
};

type Instruction = readonly [code: number, jt: number, jf: number, k: number];

/** The program as instructions, for tests and for encoding. */
export function seccompProgram(arch: SeccompArch): readonly Instruction[] {
  const table = numbers[arch];
  const program: Instruction[] = [
    [LD_ABS_W, 0, 0, OFFSET_ARCH],
    [JEQ_K, 1, 0, AUDIT_ARCH[arch]],
    [RET_K, 0, 0, RET_KILL_PROCESS],
    [LD_ABS_W, 0, 0, OFFSET_NR],
  ];
  if (arch === 'x64') program.push([JGE_K, 0, 1, X32_SYSCALL_BIT], [RET_K, 0, 0, RET_KILL_PROCESS]);
  // Each denied number: equal falls through to its return, anything else skips it.
  for (const name of deniedSyscalls)
    program.push([JEQ_K, 0, 1, table[name]], [RET_K, 0, 0, retErrno(EPERM)]);
  program.push([JEQ_K, 0, 1, table.clone3], [RET_K, 0, 0, retErrno(ENOSYS)]);
  // clone with any namespace flag in its first argument.
  program.push(
    [JEQ_K, 0, 3, table.clone],
    [LD_ABS_W, 0, 0, OFFSET_ARG0],
    [JSET_K, 0, 1, CLONE_NAMESPACE_FLAGS],
    [RET_K, 0, 0, retErrno(EPERM)],
    [RET_K, 0, 0, RET_ALLOW],
  );
  return program;
}

/** The program as bubblewrap reads it from its `--seccomp` descriptor. */
export function seccompFilter(arch: SeccompArch): Uint8Array {
  const program = seccompProgram(arch);
  const bytes = new Uint8Array(program.length * 8);
  const view = new DataView(bytes.buffer);
  program.forEach(([code, jt, jf, k], index) => {
    view.setUint16(index * 8, code, true);
    view.setUint8(index * 8 + 2, jt);
    view.setUint8(index * 8 + 3, jf);
    view.setUint32(index * 8 + 4, k, true);
  });
  return bytes;
}

export function seccompArch(arch: string = process.arch): SeccompArch | undefined {
  return arch === 'x64' || arch === 'arm64' ? arch : undefined;
}
