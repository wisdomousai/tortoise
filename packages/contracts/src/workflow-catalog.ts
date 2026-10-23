import type { CatalogOperation } from './catalog';
import { invokesClosure } from './invokes';
import {
  DAY,
  MAX_WORKFLOW_DURATION_MS,
  MINUTE,
  bindingsOf,
  conditionValues,
  isDeclared,
  type Binding,
  type Bound,
  type CatalogWorkflow,
  type WorkflowDeclaration,
  type WorkflowStep,
} from './workflow';

const STEP_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SECOND = 1_000;

/**
 * Check a declared workflow against the catalog: steps name operations of the right kind that
 * reach no `workflow.*` operation, bindings read only the input and earlier steps, every
 * required input field is bound, each wait has a watch or a recheck, and every duration is in
 * range. Returns the catalog form.
 */
export function catalogWorkflow(
  workflow: WorkflowDeclaration,
  operations: readonly CatalogOperation[],
): CatalogWorkflow {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  const fail = (message: string): never => {
    throw new Error(`Workflow ${workflow.id} ${message}`);
  };
  for (const id of workflow.operations)
    if (!byId.has(id)) fail(`references unknown operation ${id}`);
  if (!isDeclared(workflow)) return workflow;
  const { version, maxDurationMs, start, steps } = workflow;
  if (!Number.isSafeInteger(version) || version < 1) fail('needs a positive integer version');
  if (!(maxDurationMs >= MINUTE && maxDurationMs <= MAX_WORKFLOW_DURATION_MS))
    fail('needs a maximum duration between one minute and 90 days');
  if (start !== undefined && byId.get(start)?.kind !== 'command')
    fail(`starts from unknown command ${start}`);
  if (!steps.length) fail('has no steps');

  const operation = (id: string, kind: 'command' | 'query', step: string) => {
    const found = byId.get(id);
    if (found?.kind !== kind) fail(`step ${step} names unknown ${kind} ${id}`);
    if (invokesClosure({ operations }, [id]).some((reached) => reached.startsWith('workflow.')))
      fail(`step ${step} reaches a workflow operation through ${id}`);
    return found!;
  };
  const bound = (
    target: CatalogOperation,
    input: { readonly [key: string]: Bound },
    step: string,
  ) => {
    const required = (target.inputSchema.required ?? []) as string[];
    for (const field of required)
      if (!Object.hasOwn(input, field))
        fail(`step ${step} leaves ${target.id} input ${field} unbound`);
  };
  const seen = new Map<string, WorkflowStep>();
  const readable = (
    binding: Binding,
    step: WorkflowStep,
    own: { self?: boolean; result?: boolean },
  ) => {
    if (binding.$from === 'input') return;
    if (binding.$from === 'result') {
      if (!own.result) fail(`step ${step.id} reads a wait result outside its condition`);
      return;
    }
    const source = binding.step === step.id && own.self ? step : seen.get(binding.step);
    if (!source) fail(`step ${step.id} reads ${binding.step} before it runs`);
    if (binding.$from === 'effect') {
      if (source!.kind !== 'run' || source!.await !== 'effects')
        fail(
          `step ${step.id} reads an effect of ${binding.step}, which does not await its effects`,
        );
      if (!Number.isSafeInteger(binding.index) || binding.index < 0)
        fail(`step ${step.id} reads an effect by an invalid index`);
    }
  };
  const check = (
    values: readonly Bound[],
    step: WorkflowStep,
    own: { self?: boolean; result?: boolean } = {},
  ) => {
    for (const value of values)
      for (const binding of bindingsOf(value)) readable(binding, step, own);
  };

  for (const step of steps) {
    if (!STEP_ID.test(step.id) || seen.has(step.id))
      fail(`has an invalid or duplicate step ${step.id}`);
    if (step.kind === 'run') {
      bound(operation(step.command, 'command', step.id), step.input, step.id);
      check(Object.values(step.input), step);
      if (step.when) check(conditionValues(step.when), step);
      if (step.compensate) {
        bound(
          operation(step.compensate.command, 'command', step.id),
          step.compensate.input,
          step.id,
        );
        check(Object.values(step.compensate.input), step, { self: true });
      }
      const retry = step.retry;
      if (
        retry &&
        (!Number.isSafeInteger(retry.attempts) ||
          retry.attempts < 1 ||
          retry.attempts > 20 ||
          (retry.backoffMs !== undefined && !(retry.backoffMs >= 0 && retry.backoffMs <= DAY)))
      )
        fail(`step ${step.id} retries out of range`);
    } else {
      bound(operation(step.query, 'query', step.id), step.input, step.id);
      check(Object.values(step.input), step);
      check(conditionValues(step.until), step, { result: true });
      if (!step.watch?.length && step.recheckMs === undefined)
        fail(`step ${step.id} waits with neither a watch nor a recheck`);
      if (step.recheckMs !== undefined && !(step.recheckMs >= SECOND && step.recheckMs <= DAY))
        fail(`step ${step.id} rechecks out of range`);
      if (!(step.timeoutMs >= SECOND && step.timeoutMs <= maxDurationMs))
        fail(`step ${step.id} times out out of range`);
    }
    seen.set(step.id, step);
  }
  const { input, ...rest } = workflow;
  return { ...rest, inputSchema: input.jsonSchema };
}
