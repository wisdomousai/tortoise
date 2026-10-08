import { ApplicationError } from '@agent-native/contracts';
import type {
  Effect,
  EffectOutcome,
  EffectRequest,
  ExecutionContext,
  HandlerContext,
  WorkspaceSnapshot,
} from '../types.js';
import { grantCoversResource } from './delegation.js';
import {
  assertEffectRequest,
  boundedText,
  byCreation,
  enqueuedEffect,
  ownEffect,
  pendingEffect,
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
  readonly query: boolean;
  /** Resources the handler declared changed, with their journal event type. */
  readonly changes: Map<string, string>;
  /** Effects the handler enqueued, settled or released, in order. */
  readonly touched: Effect[];
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
        }),
      );
      return id;
    },
    settleEffect(id: string, outcome: EffectOutcome) {
      writable(scope, 'Queries cannot settle effects');
      const settled = settledEffect(pendingEffect(snapshot, id), outcome, kernel.now);
      touch(settled);
      return structuredClone(settled);
    },
    releaseEffect(id: string) {
      writable(scope, 'Queries cannot release effects');
      const effect = ownEffect(snapshot, id);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      const released = releasedEffect(effect);
      touch(released);
      return structuredClone(released);
    },
  };
}

function readEffects<State>(
  snapshot: WorkspaceSnapshot<State>,
  filter: Parameters<HandlerContext<State, unknown>['effects']>[0] = {},
) {
  return structuredClone(
    Object.values(snapshot.effects)
      .filter(
        (effect) =>
          (filter.status === undefined || effect.status === filter.status) &&
          (filter.target === undefined || effect.target === filter.target) &&
          (filter.held === undefined || (effect.heldAt !== undefined) === filter.held),
      )
      .sort(byCreation),
  );
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
    ...outboxMethods(kernel, scope),
    effects: (filter) => readEffects(snapshot, filter),
  };
}
