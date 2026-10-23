import type { Catalog, CatalogOperation } from './catalog';

/** Deepest chain of nested calls below an operation, at runtime and in the declarations. */
export const MAX_INVOKE_DEPTH = 4;

const declaredCalls = (operation: CatalogOperation | undefined) =>
  Array.isArray(operation?.invokes) ? (operation.invokes as readonly string[]) : [];

/**
 * The operations and every operation their `invokes` lists reach, transitively, in that order.
 * `invokes: 'any'` adds nothing: an operation that runs whatever its input names cannot widen a
 * grant by declaration, so what it runs must be in the grant on its own.
 */
export function invokesClosure(
  catalog: Pick<Catalog, 'operations'>,
  operations: readonly string[],
): string[] {
  const byId = new Map(catalog.operations.map((operation) => [operation.id, operation]));
  const reached: string[] = [];
  const visit = (id: string) => {
    if (reached.includes(id)) return;
    reached.push(id);
    declaredCalls(byId.get(id)).forEach(visit);
  };
  operations.forEach(visit);
  return reached;
}

/** Each operation's own entries, then those of the operations it reaches, without repeats. */
const union = (
  closure: readonly CatalogOperation[],
  field: 'destinations' | 'processes' | 'folders',
) => [...new Set(closure.flatMap((operation) => operation[field] ?? []))];

/**
 * Check the declared calls: every target exists, a query invokes only queries, no operation
 * reaches itself, and no chain goes deeper than `MAX_INVOKE_DEPTH`. Then give each operation
 * the destinations, processes and folders of everything it reaches, so the data-flow manifest
 * shows what a composite command reaches through the commands it invokes.
 */
export function composeInvokes(operations: readonly CatalogOperation[]): CatalogOperation[] {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  for (const operation of operations)
    for (const target of declaredCalls(operation)) {
      const callee = byId.get(target);
      if (!callee) throw new Error(`Operation ${operation.id} invokes unknown operation ${target}`);
      if (operation.kind === 'query' && callee.kind !== 'query')
        throw new Error(`Query ${operation.id} invokes command ${target}`);
    }
  const height = new Map<string, number>();
  const path: string[] = [];
  const measure = (id: string): number => {
    const known = height.get(id);
    if (known !== undefined) return known;
    if (path.includes(id))
      throw new Error(
        `Operation ${id} invokes itself: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`,
      );
    path.push(id);
    const below = Math.max(-1, ...declaredCalls(byId.get(id)).map(measure)) + 1;
    path.pop();
    height.set(id, below);
    return below;
  };
  for (const operation of operations)
    if (measure(operation.id) > MAX_INVOKE_DEPTH)
      throw new Error(
        `Operation ${operation.id} nests calls more than ${MAX_INVOKE_DEPTH} levels deep`,
      );
  return operations.map((operation) => {
    if (!declaredCalls(operation).length) return operation;
    const closure = invokesClosure({ operations }, [operation.id]).map((id) => byId.get(id)!);
    const destinations = union(closure, 'destinations');
    const processes = union(closure, 'processes');
    const folders = union(closure, 'folders');
    return {
      ...operation,
      ...(destinations.length ? { destinations } : {}),
      ...(processes.length ? { processes } : {}),
      ...(folders.length ? { folders } : {}),
    };
  });
}
