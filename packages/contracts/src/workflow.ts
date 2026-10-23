import type { JsonObject, JsonValue } from './json';
import type { Schema } from './schema';

/**
 * Where a step reads a value: the workflow input, an earlier step's result, an effect an earlier
 * step enqueued (its outcome once settled), or the result of the wait being evaluated. `path`
 * is dot-separated; empty reads the whole value.
 */
export type Binding =
  | { readonly $from: 'input'; readonly path: string }
  | { readonly $from: 'step'; readonly step: string; readonly path: string }
  | {
      readonly $from: 'effect';
      readonly step: string;
      readonly index: number;
      readonly path: string;
    }
  | { readonly $from: 'result'; readonly path: string };

/** A value with bindings anywhere in it; everything else is taken literally. */
export type Bound = Binding | JsonValue | readonly Bound[] | { readonly [key: string]: Bound };

export const from = {
  input: (path = ''): Binding => ({ $from: 'input', path }),
  step: (step: string, path = ''): Binding => ({ $from: 'step', step, path }),
  /** The `index`th effect the step enqueued, in order; its outcome once settled. */
  effect: (step: string, index: number, path = ''): Binding => ({
    $from: 'effect',
    step,
    index,
    path,
  }),
  /** Inside a wait's `until`: the query result being checked. */
  result: (path = ''): Binding => ({ $from: 'result', path }),
};

export type Condition =
  | { readonly equals: readonly [Bound, Bound] }
  | { readonly in: readonly [Bound, readonly JsonValue[]] }
  | { readonly exists: Bound }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition };

export interface RetryPolicy {
  /** Attempts in all, the first included. */
  readonly attempts: number;
  readonly backoffMs?: number;
  /** Error codes retried besides the transient ones (`UNAVAILABLE`, `CONFLICT`). */
  readonly on?: readonly string[];
}

export interface RunStep {
  readonly kind: 'run';
  readonly id: string;
  readonly command: string;
  readonly input: { readonly [key: string]: Bound };
  /** Wait until every effect the command enqueued is settled before the next step. */
  readonly await?: 'effects';
  readonly retry?: RetryPolicy;
  /** Undoes the step when a later step fails permanently; run in reverse order. */
  readonly compensate?: {
    readonly command: string;
    readonly input: { readonly [key: string]: Bound };
  };
  /** Skip the step unless this holds. */
  readonly when?: Condition;
}

export interface WaitStep {
  readonly kind: 'wait';
  readonly id: string;
  readonly query: string;
  readonly input: { readonly [key: string]: Bound };
  /** Resource types whose journal entries make the runner check again. */
  readonly watch?: readonly string[];
  /** Check again at least this often. */
  readonly recheckMs?: number;
  readonly until: Condition;
  readonly timeoutMs: number;
}

export type WorkflowStep = RunStep | WaitStep;

/** A prose workflow tells agents a sequence; a declared one adds steps the workflows plugin runs. */
export interface WorkflowDeclaration {
  readonly id: string;
  /** The operations it names; for a declared workflow, those of its steps. */
  readonly operations: readonly string[];
  readonly text: string;
}

export interface DeclaredWorkflow<I = unknown> extends WorkflowDeclaration {
  readonly version: number;
  readonly input: Schema<I>;
  readonly maxDurationMs: number;
  /** An application command that starts it through `workflow.start`. */
  readonly start?: string;
  readonly steps: readonly WorkflowStep[];
}

/** The catalog form: everything but the input parser. */
export interface CatalogWorkflow extends WorkflowDeclaration {
  readonly version?: number;
  readonly inputSchema?: JsonObject;
  readonly maxDurationMs?: number;
  readonly start?: string;
  readonly steps?: readonly WorkflowStep[];
}

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
/** The longest a workflow instance may run, and so the longest it acts for its starter. */
export const MAX_WORKFLOW_DURATION_MS = 90 * DAY;

/** The step builders: `step.run` runs a command, `step.wait` waits on a query. */
export const step = {
  run: (
    id: string,
    command: string,
    options: Omit<RunStep, 'kind' | 'id' | 'command'>,
  ): RunStep => ({
    kind: 'run',
    id,
    command,
    ...options,
  }),
  wait: (
    id: string,
    query: string,
    options: Omit<WaitStep, 'kind' | 'id' | 'query'>,
  ): WaitStep => ({
    kind: 'wait',
    id,
    query,
    ...options,
  }),
};

/** A declared workflow; `buildCatalog` checks it against the operations it names. */
export function defineWorkflow<I>(workflow: {
  readonly id: string;
  readonly version: number;
  readonly text: string;
  readonly input: Schema<I>;
  readonly maxDurationMs: number;
  readonly start?: string;
  readonly steps: readonly WorkflowStep[];
}): DeclaredWorkflow<I> {
  const operations = [
    ...new Set(
      workflow.steps.flatMap((step) =>
        step.kind === 'wait'
          ? [step.query]
          : [step.command, ...(step.compensate ? [step.compensate.command] : [])],
      ),
    ),
  ];
  return Object.freeze({ ...workflow, operations });
}

export const isDeclared = (workflow: WorkflowDeclaration): workflow is DeclaredWorkflow =>
  'steps' in workflow;

export const isBinding = (value: unknown): value is Binding =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && '$from' in value;

/** Every binding in a bound value, in order. */
export function bindingsOf(value: Bound): Binding[] {
  if (isBinding(value)) return [value];
  if (Array.isArray(value)) return value.flatMap((item: Bound) => bindingsOf(item));
  if (value !== null && typeof value === 'object')
    return Object.values(value as Record<string, Bound>).flatMap(bindingsOf);
  return [];
}

/** Every bound value a condition compares. */
export function conditionValues(condition: Condition): Bound[] {
  if ('equals' in condition) return [...condition.equals];
  if ('in' in condition) return [condition.in[0]];
  if ('exists' in condition) return [condition.exists];
  if ('all' in condition) return condition.all.flatMap(conditionValues);
  if ('any' in condition) return condition.any.flatMap(conditionValues);
  return conditionValues(condition.not);
}

const describeBinding = (binding: Binding) => {
  const path = binding.path ? `.${binding.path}` : '';
  if (binding.$from === 'input') return `input${path}`;
  if (binding.$from === 'step') return `${binding.step}${path}`;
  if (binding.$from === 'effect') return `${binding.step} effect ${binding.index}${path}`;
  return `result${path}`;
};
const describeBound = (value: Bound): string =>
  isBinding(value) ? describeBinding(value) : JSON.stringify(value);
function describeCondition(condition: Condition): string {
  if ('equals' in condition)
    return `${describeBound(condition.equals[0])} = ${describeBound(condition.equals[1])}`;
  if ('in' in condition)
    return `${describeBound(condition.in[0])} in ${JSON.stringify(condition.in[1])}`;
  if ('exists' in condition) return `${describeBound(condition.exists)} is set`;
  if ('all' in condition) return condition.all.map(describeCondition).join(' and ');
  if ('any' in condition) return `(${condition.any.map(describeCondition).join(' or ')})`;
  return `not (${describeCondition(condition.not)})`;
}
const describeInput = (input: { readonly [key: string]: Bound }) =>
  Object.entries(input)
    .map(([key, value]) => `${key} from ${describeBound(value)}`)
    .join(', ');

/** The workflow's text, then its steps for a declared workflow, as Markdown. */
export function workflowMarkdown(workflow: CatalogWorkflow): string {
  if (!workflow.steps) return workflow.text;
  const steps = workflow.steps.map((step, index) => {
    const head = `${index + 1}. \`${step.id}\`: `;
    if (step.kind === 'wait')
      return `${head}wait on \`${step.query}\` (${describeInput(step.input)}) until ${describeCondition(step.until)}, at most ${step.timeoutMs / 1000} s${step.watch?.length ? `, checking on changes to ${step.watch.join(', ')}` : ''}${step.recheckMs ? `, at least every ${step.recheckMs / 1000} s` : ''}.`;
    return `${head}run \`${step.command}\` (${describeInput(step.input)})${step.when ? ` when ${describeCondition(step.when)}` : ''}${step.await ? ', then wait for its effects to settle' : ''}${step.retry ? `, up to ${step.retry.attempts} attempts` : ''}${step.compensate ? `; undone by \`${step.compensate.command}\`` : ''}.`;
  });
  return `${workflow.text}\n\nVersion ${workflow.version}, at most ${workflow.maxDurationMs! / 3_600_000} h${workflow.start ? `, started by \`${workflow.start}\`` : ''}.\n\n${steps.join('\n')}\n`;
}
