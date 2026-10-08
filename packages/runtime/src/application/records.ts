import type { WorkspaceSnapshot } from '../types.js';

/** Defined properties keep untrusted identifiers such as "__proto__" from touching prototypes. */
export function defineOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export const revisionOf = <State>(snapshot: WorkspaceSnapshot<State>, resource: string): number =>
  Object.hasOwn(snapshot.resourceRevisions, resource) ? snapshot.resourceRevisions[resource]! : 0;

/** Code-point order, independent of locale. */
export const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
