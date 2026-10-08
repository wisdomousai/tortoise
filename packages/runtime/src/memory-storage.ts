import { ApplicationError } from '@agent-native/contracts';
import type { Storage, WorkspaceSnapshot } from './types.js';

/** An empty workspace around an isolated copy of the initial feature state. */
export function createWorkspaceSnapshot<State>(state: State): WorkspaceSnapshot<State> {
  return {
    state: structuredClone(state),
    cursor: 0,
    authorizationRevision: 0,
    resourceRevisions: {},
    receipts: {},
    journal: [],
    effects: {},
  };
}

/**
 * Shared memory survives `structuredClone` by reference, so a draft could change committed state
 * outside the transaction. Find a SharedArrayBuffer or a view on one anywhere in a value.
 */
function sharesMemory(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return true;
  if (ArrayBuffer.isView(value))
    return typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer;
  if (value instanceof Map)
    return [...value].some(([key, item]) => sharesMemory(key, seen) || sharesMemory(item, seen));
  if (value instanceof Set) return [...value].some((item) => sharesMemory(item, seen));
  return Object.values(value).some((item) => sharesMemory(item, seen));
}

function refuseSharedMemory(state: unknown): void {
  if (sharesMemory(state))
    throw new ApplicationError('INTERNAL', 'Feature state must not hold shared memory');
}

/** Serialize callbacks per workspace: each waits for the previous one to settle. */
function createWorkspaceLocks() {
  const tails = new Map<string, Promise<void>>();
  return async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = tails.get(id) ?? Promise.resolve();
    let unlock!: () => void;
    const tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    tails.set(id, tail);
    await previous;
    try {
      return await action();
    } finally {
      unlock();
      if (tails.get(id) === tail) tails.delete(id);
    }
  };
}

/**
 * Reference adapter. Serial callbacks and isolated copies model the same atomic boundary as
 * durable adapters. State must be structured-clone compatible without shared memory: an initial
 * state or a commit that holds a SharedArrayBuffer is refused, because its copies would alias.
 */
export function createMemoryStorage<State>(
  initial: State | ((workspaceId: string) => State),
): Storage<State> {
  const workspaces = new Map<string, WorkspaceSnapshot<State>>();
  const locked = createWorkspaceLocks();
  const get = (id: string): WorkspaceSnapshot<State> => {
    let value = workspaces.get(id);
    if (!value) {
      value = createWorkspaceSnapshot(
        typeof initial === 'function' ? (initial as (id: string) => State)(id) : initial,
      );
      refuseSharedMemory(value.state);
      workspaces.set(id, value);
    }
    return value;
  };
  return {
    transact: (id, fn) =>
      locked(id, async () => {
        const draft = structuredClone(get(id));
        const result = await fn(draft);
        // Refused before anything is stored, so the committed copy keeps its previous state.
        refuseSharedMemory(draft.state);
        const committed = structuredClone(draft);
        const isolatedResult = structuredClone(result);
        workspaces.set(id, committed);
        return isolatedResult;
      }),
    read: (id, fn) => locked(id, async () => structuredClone(await fn(structuredClone(get(id))))),
  };
}
