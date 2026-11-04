import type { CatalogRequirements, ProcessRequirement } from '@tortoise/contracts';
import type { Findings } from './findings';
import type { SitePolicy } from './schema';

export type DeclaredProcess = ProcessRequirement & { readonly owner: string };

/** A declared process with the executable this site binds it to. */
export interface ResolvedProcess {
  readonly process: DeclaredProcess;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly sha256?: string;
  readonly env: Readonly<Record<string, string>>;
}

/** A POSIX absolute path or a Windows drive path. */
const absolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
/** Variables the process plugin sets itself or that change what code the child loads. */
const reserved =
  /^(?:HTTPS?_PROXY|ALL_PROXY|NO_PROXY|PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z_]*|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP)$/i;

/**
 * Resolve the policy's process bindings against the declared processes. Problems are findings:
 * a binding for an undeclared process, a relative executable or working directory, a variable
 * the plugin owns or one the process receives as a secret, and a `required` process left unbound.
 */
export function resolveProcesses(
  policy: SitePolicy,
  requirements: CatalogRequirements,
  report: Findings,
) {
  const declared = new Map(requirements.processes.map((item) => [item.id, item]));
  const processes = new Map<string, ResolvedProcess>();
  const disabled = new Set<string>();
  for (const [id, binding] of Object.entries(policy.processes)) {
    const process = declared.get(id);
    if (!process) {
      report.error('UNDECLARED_PROCESS', `No module or host component declares process ${id}`, id);
      continue;
    }
    if ('disabled' in binding) {
      disabled.add(id);
      continue;
    }
    const problems: string[] = [];
    if (!absolute(binding.executable)) problems.push('an absolute executable path');
    if (binding.cwd !== undefined && !absolute(binding.cwd))
      problems.push('an absolute working directory');
    for (const problem of problems)
      report.error('PROCESS_PATH', `Process ${id} must name ${problem}`, id);
    const secrets = new Set(process.secrets ?? []);
    const owned = Object.keys(binding.env).filter(
      (name) => reserved.test(name) || secrets.has(name),
    );
    for (const name of owned)
      report.error(
        'PROCESS_ENV',
        `Process ${id} may not set ${name} in the policy: the process plugin or the secret store supplies it`,
        id,
      );
    if (problems.length || owned.length) continue;
    processes.set(id, {
      process,
      executable: binding.executable,
      args: binding.args,
      ...(binding.cwd ? { cwd: binding.cwd } : {}),
      ...(binding.sha256 ? { sha256: binding.sha256 } : {}),
      env: binding.env,
    });
  }
  for (const process of declared.values())
    if (process.availability === 'required' && !processes.has(process.id))
      report.error(
        'REQUIRED_PROCESS_UNBOUND',
        `Required process ${process.id} (${process.owner}) is not bound by the site policy`,
        process.id,
      );
  return { processes, disabledProcesses: disabled };
}
