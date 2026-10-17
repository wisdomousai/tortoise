import { ApplicationError } from '@agent-native/contracts';

/** Whether a declared process can start in this deployment, and why not. */
export type ProcessAvailability =
  { readonly available: true } | { readonly available: false; readonly reason: string };

export interface ProcessSpawnOptions {
  /** Arguments after the site binding's fixed arguments. Passed as an argument vector, never a shell string. */
  readonly args?: readonly string[];
  /** Aborting stops the whole process tree. */
  readonly signal?: AbortSignal;
  /**
   * Data the child reads from inherited descriptors 3, 4, ... in this order, each ending after
   * its bytes. For a launcher that takes a filter or a file by descriptor, such as bubblewrap's
   * `--args`, `--seccomp` and `--file`, so the data never lands in a host file or the
   * argument vector. POSIX only; a provider on another platform refuses it with UNAVAILABLE.
   */
  readonly inputs?: readonly Uint8Array[];
}

/**
 * The kernel port for child processes: perception workers, hardware drivers, provider CLIs.
 * Without a plugin that provides it, every start is refused with UNAVAILABLE.
 *
 * Trust boundary: callers name a process the catalog declares, never an executable. The site
 * policy decides which executable, arguments, working directory and pin a process ID means, and
 * the provider builds the child's whole environment, so a caller cannot widen what runs or what
 * the child inherits.
 */
export interface ProcessPort {
  /** Never throws: an undeclared, unbound or disabled process answers `available: false`. */
  availability(processId: string): ProcessAvailability;
  /**
   * Start one declared, bound process. The handle is the platform's own child type (on Bun, see
   * the host's `BunProcessPort`), so the kernel leaves it opaque. Rejects UNAVAILABLE when the
   * process cannot start here and FORBIDDEN when its executable fails the site's pin.
   */
  spawn(processId: string, options?: ProcessSpawnOptions): Promise<unknown>;
}

const reason =
  'Child processes are unavailable: this application composes no plugin that provides the process port';

/** No child processes: the kernel has no policy to decide what may run, so nothing does. */
export const noProcesses: ProcessPort = Object.freeze({
  availability: () => ({ available: false, reason }) as const,
  spawn: async () => Promise.reject(new ApplicationError('UNAVAILABLE', reason)),
});
