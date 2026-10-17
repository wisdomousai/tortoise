import { dirname } from 'node:path';

/**
 * The bubblewrap argument vector for one sandbox. Everything is passed through `--args` on an
 * inherited descriptor, so neither the layout nor the proxy credential appears on the host's
 * process list, and the files the sandbox reads (`--file`) never land on the host disk.
 */

/** Where the sandbox finds what the host gives it. */
export const sandboxPaths = {
  run: '/run/agent-native',
  launcher: '/run/agent-native/launcher.ts',
  launch: '/run/agent-native/launch.json',
  connection: '/run/agent-native/connection.json',
  sockets: '/run/agent-native/sock',
  work: '/work',
} as const;

/** A host path and what it is, as the layout needs it: a directory, a symlink or a file. */
export type HostEntry =
  | { readonly kind: 'directory' }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'file' }
  | { readonly kind: 'missing' };

/** Library and certificate locations, bound read-only where the host has them. */
export const systemPaths = [
  '/lib',
  '/lib64',
  '/lib32',
  '/usr/lib',
  '/usr/lib64',
  '/usr/lib32',
  '/etc/ld.so.cache',
  '/etc/ssl/certs',
  '/etc/ca-certificates',
  '/etc/pki/tls/certs',
  '/etc/localtime',
] as const;

/** Descriptors the process port passes, in `inputs` order from 3. */
export const descriptors = { args: 3, seccomp: 4, launcher: 5, launch: 6, connection: 7 } as const;

export interface Layout {
  /** The runtime that runs the launcher, bound at its host path. */
  readonly runtime: string;
  /** Tool executables, bound at their host paths. */
  readonly tools: readonly string[];
  /** Host paths visible read-only at the same path. */
  readonly readOnly: readonly string[];
  /** A host directory bound read-write at `/work`; a private empty one when absent. */
  readonly workdir?: string;
  /** The host directory holding this run's relay sockets. */
  readonly sockets: string;
  /** Final environment inside the sandbox. */
  readonly env: Readonly<Record<string, string>>;
  /** How each system path looks on the host; read once per run. */
  readonly system: ReadonlyMap<string, HostEntry>;
}

/** The options, NUL-separated, for the `--args` descriptor. */
export function bwrapArguments(layout: Layout): string[] {
  const args = [
    '--unshare-all',
    '--unshare-user',
    '--disable-userns',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    '--cap-drop',
    'ALL',
    '--hostname',
    'sandbox',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
  ];
  for (const path of systemPaths) {
    const entry = layout.system.get(path);
    if (entry?.kind === 'symlink') args.push('--symlink', entry.target, path);
    else if (entry?.kind === 'directory' || entry?.kind === 'file')
      args.push('--ro-bind', path, path);
  }
  const bound = new Set<string>();
  for (const path of [layout.runtime, ...layout.tools, ...layout.readOnly]) {
    if (bound.has(path)) continue;
    bound.add(path);
    args.push('--ro-bind', path, path);
  }
  if (layout.workdir) args.push('--bind', layout.workdir, sandboxPaths.work);
  else args.push('--dir', sandboxPaths.work);
  // Copies on the sandbox's own tmpfs, readable by its user only. (A `--ro-bind-data` file is a
  // deleted host temp file, which Bun cannot load a module from.)
  args.push('--dir', sandboxPaths.run);
  for (const [fd, path] of [
    [descriptors.launcher, sandboxPaths.launcher],
    [descriptors.launch, sandboxPaths.launch],
    [descriptors.connection, sandboxPaths.connection],
  ] as const)
    args.push('--perms', '0400', '--file', String(fd), path);
  args.push('--ro-bind', layout.sockets, sandboxPaths.sockets, '--chdir', sandboxPaths.work);
  for (const [name, value] of Object.entries(layout.env)) args.push('--setenv', name, value);
  args.push('--seccomp', String(descriptors.seccomp));
  return args;
}

/**
 * The process arguments: the options by descriptor, then the command. Bubblewrap reads only
 * options from `--args`, so the command stays here; it names the launcher, never the task.
 */
export function bwrapCommand(runtime: string): string[] {
  return [
    '--args',
    String(descriptors.args),
    '--',
    runtime,
    sandboxPaths.launcher,
    sandboxPaths.launch,
  ];
}

/** NUL-terminated, as `--args` reads them. */
export function encodeArguments(args: readonly string[]): Uint8Array {
  return new TextEncoder().encode(args.map((arg) => `${arg}\0`).join(''));
}

/** `PATH` inside the sandbox: the directories of the declared tools, nothing else. */
export function toolPath(tools: readonly string[]): string {
  return [...new Set(tools.map((tool) => dirname(tool)))].join(':');
}
