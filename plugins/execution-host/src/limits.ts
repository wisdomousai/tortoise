import { ApplicationError } from '@agent-native/contracts';

/** What one sandbox run may use. The host enforces the first two; the kernel the rest. */
export interface SandboxLimits {
  /** Wall time before the sandbox is stopped. */
  readonly wallMs: number;
  /** Bytes kept of stdout and of stderr each; more stops the sandbox. */
  readonly outputBytes: number;
  /** Processes and threads of the sandbox's user inside its namespace (RLIMIT_NPROC). */
  readonly processes: number;
  /** Open descriptors per process (RLIMIT_NOFILE). */
  readonly openFiles: number;
  /** Largest file a process may write (RLIMIT_FSIZE). */
  readonly fileBytes: number;
  /** CPU seconds per process (RLIMIT_CPU); unlimited when absent. */
  readonly cpuSeconds?: number;
}

export const defaultLimits: SandboxLimits = {
  wallMs: 60_000,
  outputBytes: 1 << 20,
  processes: 1_024,
  openFiles: 1_024,
  fileBytes: 1 << 30,
};

/** Limits with defaults filled in; each must be a positive integer. */
export function resolveLimits(limits: Partial<SandboxLimits> = {}): SandboxLimits {
  const resolved = { ...defaultLimits, ...limits };
  for (const [name, value] of Object.entries(resolved))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new ApplicationError(
        'INVALID_INPUT',
        `Sandbox limit ${name} must be a positive integer`,
      );
  return resolved;
}

/** The kernel limits, as the launcher sets them. */
export function kernelLimits(limits: SandboxLimits): Record<string, number> {
  return {
    processes: limits.processes,
    openFiles: limits.openFiles,
    fileBytes: limits.fileBytes,
    ...(limits.cpuSeconds ? { cpuSeconds: limits.cpuSeconds } : {}),
  };
}
