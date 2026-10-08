export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function assertJson(value: unknown, path = '$'): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    // `forEach` skips holes, which JSON would turn into null; a sparse array is not JSON.
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new TypeError(`Sparse array at ${path}[${i}]`);
      assertJson(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) assertJson(item, `${path}.${key}`);
    return;
  }
  throw new TypeError(`Non-JSON value at ${path}`);
}

/** Stable JSON serialization is shared by generation and request fingerprints. */
export function canonicalJson(value: unknown): string {
  assertJson(value);
  const sort = (item: JsonValue): JsonValue =>
    Array.isArray(item)
      ? item.map(sort)
      : item !== null && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sort(item[key]!)]),
          )
        : item;
  return JSON.stringify(sort(value));
}
