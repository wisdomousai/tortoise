import {
  canonicalJson,
  invokesClosure,
  isDeclared,
  MAX_INVOKE_DEPTH,
  type Catalog,
  type CapabilityModule,
  type DeclaredWorkflow,
} from '@agent-native/contracts';
import { readPaths } from './bindings';
import { workflowOperations as ops } from './contracts';

/** A declared workflow as the plugin runs it. */
export interface Definition {
  readonly workflow: DeclaredWorkflow;
  /** The steps' operations and everything they invoke: what an instance's grant lists. */
  readonly operations: readonly string[];
  /** Version and steps; an instance whose fingerprint no longer matches stalls. */
  readonly fingerprint: string;
  readonly paths: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Deepest nested chain below `operation`, by declaration. */
function depth(catalog: Pick<Catalog, 'operations'>, operation: string): number {
  const found = catalog.operations.find((candidate) => candidate.id === operation);
  const calls = Array.isArray(found?.invokes) ? (found.invokes as readonly string[]) : [];
  return calls.length ? 1 + Math.max(...calls.map((call) => depth(catalog, call))) : 0;
}

/**
 * The declared workflows of the application's modules, keyed by id. The catalog already checked
 * them; this adds that each step runs one level below `workflow.advance`, so a step whose calls
 * nest the full depth is refused here rather than on its first run.
 */
export function resolveWorkflows(
  modules: readonly CapabilityModule[],
  catalog: Pick<Catalog, 'operations'>,
): ReadonlyMap<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const workflow of modules.flatMap((module) => module.workflows ?? []))
    if (isDeclared(workflow)) {
      for (const operation of workflow.operations)
        if (depth(catalog, operation) >= MAX_INVOKE_DEPTH)
          throw new Error(
            `Workflow ${workflow.id} runs ${operation}, whose nested calls go too deep to run inside ${ops.advance.id}`,
          );
      definitions.set(workflow.id, {
        workflow,
        operations: invokesClosure(catalog, workflow.operations),
        fingerprint: canonicalJson({ version: workflow.version, steps: workflow.steps }),
        paths: readPaths(workflow),
      });
    }
  return definitions;
}
