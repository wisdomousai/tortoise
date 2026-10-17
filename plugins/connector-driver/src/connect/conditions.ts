import type { ConditionCheck } from '@agent-native/integration';
import type { DriverCondition, DriverContract, DriverStateField } from '../contracts';
import type { StateAnswer } from '../protocol';

/** Resolve `$input.a.b` against the action input; anything else is a literal. */
export function resolveBinding(value: unknown, input: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('$input')) return value;
  let current: unknown = input;
  for (const key of value.split('.').slice(1)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Numbers match within half a displayed digit; everything else by trimmed text. */
export function valueMatches(field: DriverStateField, observed: unknown, expected: unknown) {
  if (observed === null || observed === undefined || expected === undefined || expected === null)
    return false;
  if (field.type === 'number') {
    const [a, b] = [Number(observed), Number(expected)];
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= 0.5 * 10 ** -(field.decimals ?? 6)
    );
  }
  return String(observed).trim() === String(expected).trim();
}

/**
 * Evaluate conditions against one state read. A value missing, or below the field's
 * `minConfidence`, is `unknown`, never met: an unsure instrument cannot establish a state.
 */
export function evaluate(
  contract: DriverContract,
  view: StateAnswer,
  conditions: readonly DriverCondition[],
  input: unknown,
): ConditionCheck {
  const unmet: string[] = [];
  const unknown: string[] = [];
  for (const condition of conditions) {
    const field = contract.state[condition.field]!;
    const value = view.values[condition.field];
    if (
      value === undefined ||
      (view.confidence[condition.field] ?? 1) < (field.minConfidence ?? 1)
    ) {
      unknown.push(condition.field);
      continue;
    }
    const expected =
      condition.equals !== undefined
        ? [resolveBinding(condition.equals, input)]
        : (condition.in ?? []).map((item) => resolveBinding(item, input));
    if (!expected.some((item) => valueMatches(field, value, item)))
      unmet.push(`${condition.field} is ${String(value)}`);
  }
  return { met: unmet.length === 0 && unknown.length === 0, unmet, unknown };
}

/** Consecutive agreeing reads a condition set needs: the most `stableReads` among its fields. */
export const readsFor = (contract: DriverContract, conditions: readonly DriverCondition[]) =>
  Math.max(1, ...conditions.map((item) => contract.state[item.field]?.stableReads ?? 1));
