/** Read an RFC 6901 JSON pointer (`/items/0/id`); undefined when any step is missing. */
export function readPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new Error(`JSON pointer must start with /: ${pointer}`);
  let current = value;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current) && /^(?:0|[1-9]\d*)$/.test(key)) current = current[Number(key)];
    else if (typeof current === 'object' && current !== null && Object.hasOwn(current, key))
      current = (current as Record<string, unknown>)[key];
    else return undefined;
  }
  return current;
}
