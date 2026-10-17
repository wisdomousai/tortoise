import type { Target } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
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
   * Trusted identity for both directions. Grant it only the settle, sync and status operations,
   * so a misbehaving adapter cannot drive business commands or read other features.
   */
  readonly context: ExecutionContext;
  readonly settleOperation: string;
  readonly syncOperation: string;
  /** Authorized query whose result carries the stored inbound `watermark`. */
  readonly statusOperation: string;
  readonly toInput: InboundSyncOptions<Item>['toInput'];
}

/**
 * One system of record wired in both directions: the outbox dispatcher delivers committed effects
 * to the port and the inbound sync pulls its changes, both under one trusted identity. It owns no
 * state; every write goes through the application's settle and sync commands. `start` runs the
 * background loops (sync every 5 s and delivery every 1 s by default); `stop` waits for both.
 */
export function createTargetIntegration<Item>(options: TargetIntegrationOptions<Item>) {
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: options.port,
    context: options.context,
    settleOperation: options.settleOperation,
  });
  const inbound = createInboundSync<Item>({
    application: options.application,
    port: options.port,
    context: options.context,
    syncOperation: options.syncOperation,
    readCursor: async () =>
      (
        (await options.application.query(
          { operation: options.statusOperation, input: {} },
          options.context,
        )) as { data: { watermark?: string } }
      ).data.watermark,
    toInput: options.toInput,
  });
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
 * settle, sync and status operations and the principal's narrow grant come from the
 * declaration; `toInput` defaults to passing the pulled batch through as the sync input.
 */
export function connectTarget<Item>(options: {
  readonly target: Target;
  readonly application: TargetIntegrationOptions<Item>['application'];
  readonly port: SystemOfRecordPort<Item>;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly toInput?: TargetIntegrationOptions<Item>['toInput'];
}): TargetIntegration<Item> {
  if (!options.target.sync)
    throw new Error(`Target ${options.target.target} declares no feed to pull`);
  return createTargetIntegration<Item>({
    application: options.application,
    port: options.port,
    context: targetContext(options.target, options.workspaceId, options.principalId),
    settleOperation: options.target.settle.id,
    syncOperation: options.target.sync.id,
    statusOperation: options.target.status.id,
    toInput: options.toInput ?? ((batch) => batch),
  });
}
