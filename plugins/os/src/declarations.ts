import type {
  CapabilityModule,
  HostComponent,
  OsAction,
  OsActionKind,
  OsHandler,
  OsHandlerKind,
} from '@tortoise/contracts';

/** The kinds this plugin serves itself; other plugins enable the rest through `services.os`. */
export const baseHandlerKinds: readonly OsHandlerKind[] = ['link', 'file'];
export const baseActionKinds: readonly OsActionKind[] = ['open', 'reveal', 'open-file'];

/**
 * The composed declarations with their executable schemas. The catalog holds the same
 * declarations as JSON Schema and has already refused incoherent ones; matching needs the
 * schemas' `parse`, so it reads the live modules and components.
 */
export interface OsDeclarationSet {
  readonly handlers: readonly OsHandler[];
  readonly actions: ReadonlyMap<string, OsAction>;
}

export function collectDeclarations(manifest: {
  readonly modules: readonly CapabilityModule[];
  readonly components?: readonly HostComponent[];
}): OsDeclarationSet {
  const owners = [...manifest.modules, ...(manifest.components ?? [])];
  return {
    handlers: owners.flatMap((owner) => owner.os?.handlers ?? []),
    actions: new Map(
      owners.flatMap((owner) => owner.os?.actions ?? []).map((action) => [action.id, action]),
    ),
  };
}

/** Comma-separated setting values. */
export const listSetting = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Refuse a composition that declares a handler or action kind no composed plugin serves, a
 * consumer that registered no receiver, or a disabled id that names nothing, so a declaration
 * never looks registered while nothing handles it.
 */
export function assertServed(
  declarations: OsDeclarationSet,
  enabled: { handlers: ReadonlySet<OsHandlerKind>; actions: ReadonlySet<OsActionKind> },
  consumers: ReadonlySet<string>,
  disabled: readonly string[],
) {
  const problems: string[] = [];
  for (const handler of declarations.handlers) {
    if (!enabled.handlers.has(handler.kind))
      problems.push(
        `${handler.kind} handler ${handler.id} needs a plugin that serves ${handler.kind}`,
      );
    const consumer =
      handler.kind === 'reply'
        ? handler.consumer
        : 'consumer' in handler.target
          ? handler.target.consumer
          : undefined;
    if (consumer && !consumers.has(consumer))
      problems.push(
        `handler ${handler.id} names consumer ${consumer}, which registered no receiver`,
      );
  }
  for (const action of declarations.actions.values())
    if (!enabled.actions.has(action.kind))
      problems.push(`${action.kind} action ${action.id} needs a plugin that serves ${action.kind}`);
  const known = new Set([
    ...declarations.handlers.map((handler) => handler.id),
    ...declarations.actions.keys(),
  ]);
  for (const id of disabled)
    if (!known.has(id)) problems.push(`os-disabled names unknown id ${id}`);
  if (problems.length) throw new Error(`OS integration cannot start: ${problems.join('; ')}`);
}
