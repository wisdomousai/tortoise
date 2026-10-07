/** Compare structured-clone state without imposing JSON, SQL or a business-record shape on storage. */
export function sameState(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (seen.get(left)?.has(right)) return true;
  const paired = seen.get(left) ?? new WeakSet<object>();
  paired.add(right);
  seen.set(left, paired);
  if (left instanceof Date && right instanceof Date)
    return Object.is(left.getTime(), right.getTime());
  if (left instanceof RegExp && right instanceof RegExp)
    return left.source === right.source && left.flags === right.flags;
  if (left instanceof Map && right instanceof Map)
    return left.size === right.size && sameState([...left], [...right], seen);
  if (left instanceof Set && right instanceof Set)
    return left.size === right.size && sameState([...left], [...right], seen);
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer)
    return sameBytes(new Uint8Array(left), new Uint8Array(right));
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right))
    return sameBytes(
      new Uint8Array(left.buffer, left.byteOffset, left.byteLength),
      new Uint8Array(right.buffer, right.byteOffset, right.byteLength),
    );
  const keys = Reflect.ownKeys(left);
  const otherKeys = Reflect.ownKeys(right);
  if (keys.length !== otherKeys.length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) && sameState(Reflect.get(left, key), Reflect.get(right, key), seen),
  );
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
