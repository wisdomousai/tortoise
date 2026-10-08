/** `$input.<path>`: a reference into the effect payload. */
export const inputBinding = /^\$input\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)$/;

/** Resolve a literal or `$input.<path>` against an effect payload; undefined when absent. */
export function resolveBinding(value: string | number | boolean, input: unknown): unknown {
  if (typeof value !== 'string') return value;
  const match = inputBinding.exec(value);
  if (!match) return value.startsWith('$input') ? undefined : value;
  let current: unknown = input;
  for (const key of match[1]!.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
