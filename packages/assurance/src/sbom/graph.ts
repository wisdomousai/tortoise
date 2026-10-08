import { purl, splitIdent, type BunLock } from './lock';

/**
 * The lock's dependency graph: a component reference per package key, edges resolved the way
 * the lock nests them, the root's runtime and development entry points, and every package
 * reachable from runtime dependencies.
 */
export function lockGraph(lock: BunLock) {
  const entries = Object.entries(lock.packages);
  const refOf = new Map<string, string>();
  for (const [key, [ident]] of entries) {
    const { name, version } = splitIdent(ident);
    refOf.set(key, version.startsWith('workspace:') ? `workspace:${name}` : purl(name, version));
  }
  /** Resolve a dependency the way the lock nests it: innermost `parent/…/name` first. */
  const resolve = (fromKey: string, dependency: string) => {
    const parts = fromKey ? fromKey.split('/') : [];
    for (let end = parts.length; end >= 0; end--) {
      const key = [...parts.slice(0, end), dependency].join('/');
      if (lock.packages[key]) return key;
    }
    return undefined;
  };
  const edges = new Map<string, Set<string>>();
  for (const [key, [, , meta]] of entries) {
    const targets = new Set<string>();
    for (const dependency of Object.keys({
      ...meta?.dependencies,
      ...meta?.optionalDependencies,
    })) {
      const found = resolve(key, dependency);
      if (found) targets.add(found);
    }
    edges.set(key, targets);
  }
  const rootRuntime: string[] = [];
  const rootDevelopment: string[] = [];
  for (const workspace of Object.values(lock.workspaces)) {
    for (const name of Object.keys({
      ...workspace.dependencies,
      ...workspace.optionalDependencies,
    })) {
      const found = resolve('', name);
      if (found) rootRuntime.push(found);
    }
    for (const name of Object.keys(workspace.devDependencies ?? {})) {
      const found = resolve('', name);
      if (found) rootDevelopment.push(found);
    }
  }
  return {
    entries,
    refOf,
    edges,
    rootRuntime,
    rootDevelopment,
    runtime: reach(edges, rootRuntime),
  };
}
export type LockGraph = ReturnType<typeof lockGraph>;

function reach(edges: ReadonlyMap<string, Set<string>>, starts: readonly string[]) {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(edges.get(key) ?? []));
  }
  return seen;
}
