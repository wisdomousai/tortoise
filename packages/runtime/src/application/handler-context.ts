import {
  ApplicationError,
  blobFits,
  isBlobRef,
  type BlobRef,
  type JsonValue,
} from '@agent-native/contracts';
import type {
  Effect,
  EffectOutcome,
  EffectRequest,
  ExecutionContext,
  HandlerContext,
  Invocation,
  WorkspaceSnapshot,
} from '../types.js';
import type { BlobChange } from './blob-references.js';
import { grantCoversResource } from './delegation.js';
import {
  assertEffectRequest,
  boundedText,
  byCreation,
  enqueuedEffect,
  cancelledEffect,
  ownEffect,
  pendingEffect,
  publicEffect,
  putEffect,
  releasedEffect,
  settledEffect,
} from './effects.js';
import type { Kernel } from './kernel.js';
import { revisionOf } from './records.js';

/** What one handler call may touch. Queries get a scope whose writes all fail. */
export interface HandlerScope<State> {
  readonly snapshot: WorkspaceSnapshot<State>;
  readonly context: ExecutionContext;
  readonly operation: string;
  /** The command's parsed input, kept on the effects it enqueues for the dispatch recheck. */
  readonly input?: unknown;
  readonly query: boolean;
  /** Resources the handler declared changed, with their journal event type. */
  readonly changes: Map<string, string>;
  /** Effects the handler enqueued, settled or released, in order. */
  readonly touched: Effect[];
  /** The command `continueWith` asked for; set at most once. */
  continuation?: Invocation;
  /** True inside a continued command, which may not continue again. */
  readonly continued?: boolean;
  /** Blob references the handler attached or detached, in order. */
  readonly blobs: BlobChange[];
}

function writable(scope: HandlerScope<unknown>, refusal: string): void {
  if (scope.query) throw new ApplicationError('INTERNAL', refusal);
}

/** Outbox methods: every transition is written into the draft snapshot and recorded as touched. */
function outboxMethods<State, Services>(
  kernel: Kernel<State, Services>,
  scope: HandlerScope<State>,
) {
  const { snapshot } = scope;
  const touch = (effect: Effect) => {
    putEffect(snapshot, effect);
    scope.touched.push(effect);
  };
  return {
    enqueue(request: EffectRequest) {
      writable(scope, 'Queries cannot enqueue effects');
      assertEffectRequest(request);
      const id = kernel.newEffectId();
      if (!boundedText(id, 256) || ownEffect(snapshot, id))
        throw new ApplicationError('INTERNAL', 'Effect identifier is unavailable');
      const { operation, context } = scope;
      touch(
        enqueuedEffect(request, {
          id,
          operation,
          principalId: context.principalId,
          createdAt: kernel.now(),
          ...(scope.input === undefined ? {} : { input: scope.input as JsonValue }),
        }),
      );
      return id;
    },
    settleEffect(id: string, outcome: EffectOutcome, attempt?: { readonly fence?: number }) {
      writable(scope, 'Queries cannot settle effects');
      const effect = pendingEffect(snapshot, id);
      const settled = settledEffect(effect, outcome, kernel.now, attempt?.fence);
      touch(settled);
      return publicEffect(settled);
    },
    cancelEffect(id: string, reason: string) {
      writable(scope, 'Queries cannot cancel effects');
      const cancelled = cancelledEffect(pendingEffect(snapshot, id), reason, kernel.now);
      touch(cancelled);
      return publicEffect(cancelled);
    },
    releaseEffect(id: string) {
      writable(scope, 'Queries cannot release effects');
      const effect = ownEffect(snapshot, id);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      const released = releasedEffect(effect);
      touch(released);
      return publicEffect(released);
    },
  };
}

/** Reference changes are recorded here and checked against the store when the command commits. */
function blobMethods<State, Services>(kernel: Kernel<State, Services>, scope: HandlerScope<State>) {
  return {
    attach(resource: string, ref: BlobRef) {
      writable(scope, 'Queries cannot attach blobs');
      const limits = kernel.capabilities.get(scope.operation)?.blobs;
      if (!limits) throw new ApplicationError('INTERNAL', 'Operation declares no blob limits');
      if (!isBlobRef(ref)) throw new ApplicationError('INVALID_INPUT', 'Blob reference is invalid');
      if (!blobFits(limits, ref.size, ref.mediaType))
        throw new ApplicationError('INVALID_INPUT', 'Blob exceeds the operation limits');
      const { digest, size, mediaType } = ref;
      scope.blobs.push({ kind: 'attach', resource, ref: { digest, size, mediaType } });
    },
    detach(resource: string, digest: string) {
      writable(scope, 'Queries cannot detach blobs');
      scope.blobs.push({ kind: 'detach', resource, digest });
    },
  };
}

function readEffects<State>(
  snapshot: WorkspaceSnapshot<State>,
  filter: Parameters<HandlerContext<State, unknown>['effects']>[0] = {},
) {
  return Object.values(snapshot.effects)
    .filter(
      (effect) =>
        (filter.status === undefined || effect.status === filter.status) &&
        (filter.target === undefined || effect.target === filter.target) &&
        (filter.held === undefined || (effect.heldAt !== undefined) === filter.held),
    )
    .sort(byCreation)
    .map(publicEffect);
}

/** The capabilities a handler receives: state, services, journal declarations and the outbox. */
export function createHandlerContext<State, Services>(
  kernel: Kernel<State, Services>,
  scope: HandlerScope<State>,
): HandlerContext<State, Services> {
  const { snapshot, context } = scope;
  return {
    state: snapshot.state,
    services: kernel.options.services,
    context,
    getRevision: (resource) => revisionOf(snapshot, resource),
    invalidateAuthorization() {
      writable(scope, 'Queries cannot invalidate authorization');
      snapshot.authorizationRevision++;
    },
    change(resource, type = 'changed') {
      writable(scope, 'Queries cannot register changes');
      if (!resource)
        throw new ApplicationError('INTERNAL', 'Changed resource must have an identifier');
      if (!grantCoversResource(context.grant, resource))
        throw new ApplicationError('FORBIDDEN', 'Delegation does not permit changed resource');
      scope.changes.set(resource, type);
    },
    continueWith(operation, input, expectedRevisions) {
      writable(scope, 'Queries cannot continue with a command');
      if (scope.continued || scope.continuation)
        throw new ApplicationError('INTERNAL', 'A command continues with at most one command');
      scope.continuation = {
        operation,
        input: structuredClone(input),
        ...(expectedRevisions ? { expectedRevisions: { ...expectedRevisions } } : {}),
      };
    },
    ...outboxMethods(kernel, scope),
    ...blobMethods(kernel, scope),
    effects: (filter) => readEffects(snapshot, filter),
  };
}
