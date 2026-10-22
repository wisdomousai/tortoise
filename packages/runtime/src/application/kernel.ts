import {
  ApplicationError,
  buildCatalog,
  type AnyCapability,
  type CapabilityModule,
  type EventLogPort,
  type HostComponent,
} from '@agent-native/contracts';
import type {
  AuthorizationPort,
  BlobStore,
  ExecutionContext,
  HandlerContribution,
  Invocation,
  RemoteSource,
  Storage,
  WorkspaceSnapshot,
} from '../types.js';
import { createAuditTrail } from './audit.js';
import { createContextGuard } from './delegation.js';
import { createUploads } from './uploads.js';

export interface ApplicationOptions<State, Services, Modules extends readonly CapabilityModule[]> {
  readonly modules: Modules;
  /**
   * Non-module parts of the deployment (listener, provider SDKs, child processes). Only their
   * declared requirements enter the catalog, so the published manifest covers the whole host.
   */
  readonly components?: readonly HostComponent[];
  readonly handlers: readonly HandlerContribution<State, Services>[];
  readonly storage: Storage<State>;
  readonly authorization: AuthorizationPort<State>;
  readonly services: Services;
  readonly now?: () => number;
  readonly contractVersion?: string;
  /** Outbox effect identifiers; they must be globally unique because targets deduplicate by them. */
  readonly newEffectId?: () => string;
  /**
   * Audit sink. When present, every command, query, denial, outbox transition and delivery
   * attempt is recorded. Its `mode` decides whether an unwritable log blocks the action.
   */
  readonly eventLog?: EventLogPort;
  /** Sources for remote queries, by target. A remote query whose target has none is `unavailable`. */
  readonly sources?: Readonly<Record<string, RemoteSource>>;
  /** Longest wait for a source before a remote query reports it unavailable. Defaults to 10 s. */
  readonly remoteDeadlineMs?: number;
  /**
   * The blob store of a workspace. Each workspace needs its own store, because sweeping removes
   * whatever that workspace does not reference. Without one, uploads and attaching fail with
   * UNAVAILABLE.
   */
  readonly blobStore?: (workspaceId: string) => BlobStore | undefined;
  /**
   * How long an upload stays attachable by its uploader and safe from sweeping. Defaults to one
   * hour.
   */
  readonly blobGraceMs?: number;
}

/** Pair each capability with exactly one handler that references that same capability object. */
function registerHandlers<State, Services>(
  capabilities: ReadonlyMap<string, AnyCapability>,
  contributions: readonly HandlerContribution<State, Services>[],
) {
  const handlers = new Map<string, HandlerContribution<State, Services>>();
  for (const handler of contributions) {
    if (capabilities.get(handler.capability.id) !== handler.capability)
      throw new Error(`Handler does not reference registered capability: ${handler.capability.id}`);
    if (handlers.has(handler.capability.id))
      throw new Error(`Duplicate handler: ${handler.capability.id}`);
    // A remote query must not compute output from local state alone, and a local one must not
    // reach a source: the declaration and the handler shape have to agree.
    if (!handler.capability.remote !== !handler.remote)
      throw new Error(`Remote declaration and handler disagree: ${handler.capability.id}`);
    handlers.set(handler.capability.id, handler);
  }
  for (const id of capabilities.keys())
    if (!handlers.has(id)) throw new Error(`Missing handler: ${id}`);
  return handlers;
}

/**
 * Everything the runtime's parts share: the registry, the ports, the clocks and recent uploads.
 * Built once per application; it holds no per-request state.
 */
export function createKernel<State, Services>(
  options: ApplicationOptions<State, Services, readonly CapabilityModule[]>,
) {
  const catalog = buildCatalog(options.modules, { components: options.components ?? [] });
  const capabilities = new Map(
    options.modules
      .flatMap((module) => module.capabilities)
      .map((capability) => [capability.id, capability]),
  );
  const handlers = registerHandlers(capabilities, options.handlers);
  const now = options.now ?? Date.now;
  // Sources the definition supplies, plus those its connections bind once the runtime exists.
  const sources = new Map<string, RemoteSource>(Object.entries(options.sources ?? {}));
  return {
    options,
    sources,
    catalog,
    capabilities,
    handlers,
    now,
    newEffectId: options.newEffectId ?? (() => crypto.randomUUID()),
    audit: createAuditTrail(options.eventLog),
    guard: createContextGuard(now),
    uploads: createUploads(now, options.blobGraceMs ?? 3_600_000),
  };
}
export type Kernel<State, Services> = ReturnType<typeof createKernel<State, Services>>;

/** Find the operation of the expected kind and parse its input against the declared schema. */
export function resolveOperation<State, Services>(
  kernel: Kernel<State, Services>,
  request: Invocation,
  kind: 'command' | 'query',
) {
  const capability = kernel.capabilities.get(request.operation);
  if (!capability || capability.kind !== kind)
    throw new ApplicationError('NOT_FOUND', `Unknown ${kind}`);
  let input: unknown;
  try {
    input = capability.input.parse(request.input);
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'Input does not match operation schema');
  }
  return { capability, input, handler: kernel.handlers.get(capability.id)! };
}

/** Policy decision for one phase; the context is rechecked after the await. */
export async function authorize<State, Services>(
  kernel: Kernel<State, Services>,
  capability: AnyCapability,
  input: unknown,
  context: ExecutionContext,
  snapshot: WorkspaceSnapshot<State>,
  phase: 'invoke' | 'commit' | 'replay' | 'dispatch',
  previousState?: State,
) {
  kernel.guard.active(context, capability.id);
  const decision = await kernel.options.authorization.authorize({
    capability,
    input,
    context,
    state: snapshot.state,
    phase,
    ...(previousState === undefined ? {} : { previousState }),
  });
  kernel.guard.active(context, capability.id);
  if (!decision.allowed)
    throw new ApplicationError('FORBIDDEN', decision.reason ?? 'Operation denied');
}

/** Project output to what the caller may read, then validate it against the declared schema. */
export async function project<State, Services>(
  kernel: Kernel<State, Services>,
  capability: AnyCapability,
  input: unknown,
  context: ExecutionContext,
  snapshot: WorkspaceSnapshot<State>,
  output: unknown,
) {
  const projectOutput = kernel.options.authorization.projectOutput;
  const visible = projectOutput
    ? await projectOutput({ capability, input, context, state: snapshot.state, output })
    : output;
  try {
    return capability.output.parse(visible);
  } catch {
    throw new ApplicationError('INVALID_OUTPUT', 'Output does not match operation schema');
  }
}
