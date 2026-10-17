import type {
  JsonObject,
  OsActionOutcome,
  OsInstruction,
  OsRefusal,
} from '@agent-native/contracts';
import type { ShellAdapter } from '@agent-native/kernel/plugin';
import type { ExecutionContext } from '@agent-native/runtime';
import { buildInstruction, OsActionError } from '@agent-native/shell';
import type { OsAudit } from './audit';
import type { OsDeclarationSet } from './declarations';

/** Instructions a page can run itself while it has user activation; the rest need an adapter. */
const pageKinds: ReadonlySet<OsInstruction['kind']> = new Set(['open', 'share']);

const ownerKey = (context: ExecutionContext) => `${context.workspaceId}\0${context.principalId}`;

/** Adapters attached per principal; the most recent attachment performs. */
export function createAdapters() {
  const attached = new Map<string, ShellAdapter[]>();
  return {
    attach(context: ExecutionContext, adapter: ShellAdapter) {
      const key = ownerKey(context);
      attached.set(key, [...(attached.get(key) ?? []), adapter]);
      return () => {
        const rest = (attached.get(key) ?? []).filter((item) => item !== adapter);
        if (rest.length) attached.set(key, rest);
        else attached.delete(key);
      };
    },
    for: (context: ExecutionContext) => attached.get(ownerKey(context))?.at(-1),
    platforms: () => [...new Set([...attached.values()].flat().map((adapter) => adapter.platform))],
  };
}
export type Adapters = ReturnType<typeof createAdapters>;

export interface PerformDependencies {
  readonly declarations: OsDeclarationSet;
  readonly disabled: ReadonlySet<string>;
  readonly allow: (action: string) => boolean;
  readonly root: (key: string) => string | undefined;
  readonly adapters: Adapters;
  readonly audit: OsAudit;
}

/** What the log may hold about an instruction: the URL's origin, never its path or query. */
function describe(instruction: OsInstruction): JsonObject {
  if (instruction.kind === 'open')
    return { actionKind: 'open', origin: new URL(instruction.url).origin };
  return { actionKind: instruction.kind };
}

/**
 * Perform one declared action as `context`: the declaration, the site's disabled list and the
 * per-action rate decide, and the instruction is built from the declaration's template, never
 * from a caller's string. An adapter attached for the same principal runs it; without one, a
 * page-runnable instruction is returned for the caller to run and anything else is refused.
 */
export async function performOsAction(
  dependencies: PerformDependencies,
  context: ExecutionContext,
  request: unknown,
): Promise<OsActionOutcome> {
  const { audit } = dependencies;
  const body = request as { action?: unknown; params?: unknown } | null;
  const id =
    typeof body?.action === 'string' && body.action.length <= 128 ? body.action : undefined;
  const refuse = async (reason: OsRefusal, data: JsonObject = {}): Promise<OsActionOutcome> => {
    await audit.record(context, { kind: 'os.action.refused', reason, ...(id ? { id } : {}) }, data);
    return { status: 'refused', reason, ...(id ? { action: id } : {}) };
  };
  const params = body?.params;
  if (
    !id ||
    (params !== undefined &&
      (typeof params !== 'object' || params === null || Array.isArray(params)))
  )
    return refuse('invalid');
  const action = dependencies.declarations.actions.get(id);
  if (!action) return refuse('no-handler');
  if (dependencies.disabled.has(id)) return refuse('disabled');
  if (!dependencies.allow(id)) return refuse('rate-limited');
  let instruction: OsInstruction;
  try {
    instruction = buildInstruction(action, params as JsonObject | undefined, dependencies.root);
  } catch (error) {
    if (error instanceof OsActionError) return refuse(error.reason);
    throw error;
  }
  const adapter = dependencies.adapters.for(context);
  if (!adapter) {
    if (!pageKinds.has(instruction.kind)) return refuse('unattached', describe(instruction));
    await audit.record(
      context,
      { kind: 'os.action.performed', id },
      { ...describe(instruction), by: 'caller' },
    );
    return { status: 'instruction', instruction };
  }
  const result = await adapter.perform(instruction).catch(() => ({ ok: false }));
  if (!result.ok) return refuse('failed', { ...describe(instruction), platform: adapter.platform });
  await audit.record(
    context,
    { kind: 'os.action.performed', id, platform: adapter.platform },
    describe(instruction),
  );
  return { status: 'performed', action: id };
}

/**
 * Run an instruction a capability plugin built, such as a notification carrying the reply
 * nonces that plugin issued, through the adapter attached for `context`'s principal. The
 * instruction must name a declared action of the same kind that the site has not disabled; the
 * per-action rate applies. Without an attached adapter it is refused as `unattached`, so the
 * caller can keep it queued.
 */
export async function relayOsInstruction(
  dependencies: PerformDependencies,
  context: ExecutionContext,
  instruction: OsInstruction,
): Promise<OsActionOutcome> {
  const { audit } = dependencies;
  const id = instruction.action;
  const refuse = async (reason: OsRefusal, data: JsonObject = {}): Promise<OsActionOutcome> => {
    await audit.record(context, { kind: 'os.action.refused', reason, id }, data);
    return { status: 'refused', reason, action: id };
  };
  const action = dependencies.declarations.actions.get(id);
  if (!action || action.kind !== instruction.kind) return refuse('no-handler');
  if (dependencies.disabled.has(id)) return refuse('disabled');
  if (!dependencies.allow(id)) return refuse('rate-limited');
  const adapter = dependencies.adapters.for(context);
  if (!adapter) return refuse('unattached', describe(instruction));
  const result = await adapter.perform(instruction).catch(() => ({ ok: false }));
  if (!result.ok) return refuse('failed', { ...describe(instruction), platform: adapter.platform });
  await audit.record(
    context,
    { kind: 'os.action.performed', id, platform: adapter.platform },
    describe(instruction),
  );
  return { status: 'performed', action: id };
}
