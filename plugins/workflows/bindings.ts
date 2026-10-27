import {
  bindingsOf,
  canonicalJson,
  conditionValues,
  isBinding,
  type Binding,
  type Bound,
  type Condition,
  type DeclaredWorkflow,
  type JsonValue,
} from '@agent-native/contracts';

/** What bindings read: the instance input, the kept step values and, in a wait, its result. */
export interface Scope {
  readonly input: Readonly<Record<string, JsonValue>>;
  /** By step: kept values by path, effect values as `#<index>.<path>`. */
  readonly values: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly result?: unknown;
}

/** The value at a dot-separated path; an empty path is the whole value. */
export function valueAt(value: unknown, path: string): unknown {
  if (!path) return value;
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The key an effect value is kept under, apart from result paths. */
export const effectPath = (index: number, path: string) => `#${index}${path ? `.${path}` : ''}`;

function read(binding: Binding, scope: Scope): unknown {
  if (binding.$from === 'input') return valueAt(scope.input, binding.path);
  if (binding.$from === 'result') return valueAt(scope.result, binding.path);
  const kept = scope.values[binding.step];
  const key = binding.$from === 'effect' ? effectPath(binding.index, binding.path) : binding.path;
  return kept && Object.hasOwn(kept, key) ? kept[key] : undefined;
}

/** A bound value with its bindings read; a binding that reads nothing leaves its key out. */
export function resolve(value: Bound, scope: Scope): unknown {
  if (isBinding(value)) return read(value, scope);
  if (Array.isArray(value)) return value.map((item: Bound) => resolve(item, scope) ?? null);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, Bound>)
        .map(([key, item]) => [key, resolve(item, scope)] as const)
        .filter(([, item]) => item !== undefined),
    );
  return value;
}

const same = (a: unknown, b: unknown) =>
  a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b);

export function holds(condition: Condition, scope: Scope): boolean {
  if ('equals' in condition)
    return same(resolve(condition.equals[0], scope), resolve(condition.equals[1], scope));
  if ('in' in condition) {
    const value = resolve(condition.in[0], scope);
    return condition.in[1].some((option) => same(value, option));
  }
  if ('exists' in condition) {
    const value = resolve(condition.exists, scope);
    return value !== undefined && value !== null;
  }
  if ('all' in condition) return condition.all.every((item) => holds(item, scope));
  if ('any' in condition) return condition.any.some((item) => holds(item, scope));
  return !holds(condition.not, scope);
}

/**
 * The paths each step's result and effects are read at, by step. An instance keeps only these,
 * so its record holds what later steps and compensations need and nothing else.
 */
export function readPaths(workflow: DeclaredWorkflow): Map<string, Set<string>> {
  const paths = new Map<string, Set<string>>();
  const bounds = workflow.steps.flatMap((step): Bound[] =>
    step.kind === 'wait'
      ? [step.input, ...conditionValues(step.until)]
      : [
          step.input,
          ...(step.when ? conditionValues(step.when) : []),
          ...(step.compensate ? [step.compensate.input] : []),
        ],
  );
  for (const binding of bounds.flatMap(bindingsOf)) {
    if (binding.$from !== 'step' && binding.$from !== 'effect') continue;
    const key = binding.$from === 'effect' ? effectPath(binding.index, binding.path) : binding.path;
    const set = paths.get(binding.step) ?? new Set<string>();
    set.add(key);
    paths.set(binding.step, set);
  }
  return paths;
}

/** Keep the read paths of a step's result; `effects` are the completed effect values in order. */
export function keep(
  paths: ReadonlySet<string> | undefined,
  result: unknown,
  effects: readonly unknown[] = [],
): Record<string, JsonValue> {
  const kept: Record<string, JsonValue> = {};
  for (const path of paths ?? []) {
    const [head, ...rest] = path.split('.');
    const value = head!.startsWith('#')
      ? valueAt(effects[Number(head!.slice(1))], rest.join('.'))
      : valueAt(result, path);
    if (value !== undefined) kept[path] = value as JsonValue;
  }
  return kept;
}
