import type { Target } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';
import { targetContext } from './target-handlers.js';
import { createEffectDispatcher, type DispatcherApplication } from './dispatcher.js';
import { createInboundSync, type InboundSyncOptions } from './inbound-sync.js';
import type { SystemOfRecordPort } from './port.js';

export interface TargetIntegrationOptions<Item> {
  readonly application: DispatcherApplication & {
    query(
      request: { readonly operation: string; readonly input: unknown },
      context: ExecutionContext,
    ): Promise<{ readonly data: unknown }>;
  };
  readonly port: SystemOfRecordPort<Item>;
  /**
   * Trusted identity for both directions. Grant it only the complete, sync and status operations,
   * so a misbehaving adapter cannot call business commands or read other features.
   */
  readonly context: ExecutionContext;
  readonly completeOperation: string;
  /** The complete command takes `fence` (a `defineTarget` complete does), so completions are fenced. */
  readonly fencedCompletion?: boolean;
  /** Absent for a target without a feed: the inbound side then pulls nothing. */
  readonly syncOperation?: string;
  /** Authorized query whose result carries the stored inbound `watermark`. */
  readonly statusOperation: string;
  readonly toInput: InboundSyncOptions<Item>['toInput'];
}

/** The inbound side of a target without a feed: every pass pulls nothing. */
function idleInbound(target: string) {
  return {
    target,
    runOnce: async (_signal?: AbortSignal) => ({ batches: 0, items: 0 }),
    start: (_intervalMs: number) => undefined,
    stop: async () => undefined,
  };
}

/**
 * One system of record wired in both directions: the outbox dispatcher delivers committed effects
 * to the port and the inbound sync pulls its changes, both under one trusted identity. It owns no
 * state; every write goes through the application's complete and sync commands. `start` runs the
 * background loops (sync every 5 s and delivery every 1 s by default); `stop` waits for both.
 */
export function createTargetIntegration<Item>(options: TargetIntegrationOptions<Item>) {
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: options.port,
    context: options.context,
    completeOperation: options.completeOperation,
    ...(options.fencedCompletion
      ? {
          completeInput: (effect, outcome, attempt) => ({
            effectId: effect.id,
            outcome,
            fence: attempt.fence,
          }),
        }
      : {}),
  });
  const syncOperation = options.syncOperation;
  const inbound = syncOperation
    ? createInboundSync<Item>({
        application: options.application,
        port: options.port,
        context: options.context,
        syncOperation,
        readCursor: async () =>
          (
            (await options.application.query(
              { operation: options.statusOperation, input: {} },
              options.context,
            )) as { data: { watermark?: string } }
          ).data.watermark,
        toInput: options.toInput,
      })
    : idleInbound(dispatcher.target);
  return {
    target: dispatcher.target,
    port: options.port,
    context: options.context,
    dispatcher,
    inbound,
    start(intervals: { readonly deliverMs?: number; readonly syncMs?: number } = {}) {
      inbound.start(intervals.syncMs ?? 5_000);
      dispatcher.start(intervals.deliverMs ?? 1_000);
    },
    async stop() {
      await Promise.all([inbound.stop(), dispatcher.stop()]);
    },
  };
}
export type TargetIntegration<Item = unknown> = ReturnType<typeof createTargetIntegration<Item>>;

/**
 * Wire a declared target (`defineTarget`) to its port under its integration principal. The
 * complete, sync and status operations and the principal's narrow grant come from the
 * declaration; a target without a feed only delivers, and its inbound side pulls nothing; `toInput` defaults to passing the pulled batch through as the sync input.
 */
export function connectTarget<Item>(options: {
  readonly target: Target;
  readonly application: TargetIntegrationOptions<Item>['application'];
  readonly port: SystemOfRecordPort<Item>;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly toInput?: TargetIntegrationOptions<Item>['toInput'];
}): TargetIntegration<Item> {
  return createTargetIntegration<Item>({
    application: options.application,
    port: options.port,
    context: targetContext(options.target, options.workspaceId, options.principalId),
    completeOperation: options.target.complete.id,
    fencedCompletion: true,
    ...(options.target.sync ? { syncOperation: options.target.sync.id } : {}),
    statusOperation: options.target.status.id,
    toInput: options.toInput ?? ((batch) => batch),
  });
}
