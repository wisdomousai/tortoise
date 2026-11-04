import type { ExecutionContext } from '@tortoise/runtime';
import type { DispatcherApplication } from './dispatcher.js';
import { createLoop } from './loop.js';
import type { SystemOfRecordPort } from './port.js';

export interface InboundSyncOptions<Item> {
  readonly application: Pick<DispatcherApplication, 'invokeRaw'>;
  readonly port: SystemOfRecordPort<Item>;
  /** Trusted integration identity, granted only the sync operation. */
  readonly context: ExecutionContext;
  /** Domain command that validates `from` against its stored watermark and applies the items. */
  readonly syncOperation: string;
  /** Current watermark from authoritative domain state, normally through an authorized query. */
  readonly readCursor: () => Promise<string | undefined>;
  readonly toInput: (batch: {
    readonly from?: string;
    readonly to: string;
    readonly items: readonly Item[];
  }) => unknown;
  readonly maxBatches?: number;
}

/**
 * Pulls target changes and submits them as ordinary sync commands; it never writes storage. The
 * idempotency key binds the watermark range, so a repeated pass after a lost response is safe, and
 * the domain command rejects a stale `from` watermark with CONFLICT.
 */
export function createInboundSync<Item>(options: InboundSyncOptions<Item>) {
  if (!options.port.pull) throw new Error('Inbound sync requires a target that supports pull');
  async function runOnce(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ batches: number; items: number }> {
    let batches = 0;
    let items = 0;
    for (let index = 0; index < (options.maxBatches ?? 20) && !signal.aborted; index++) {
      const from = await options.readCursor();
      const batch = await options.port.pull!(from, signal);
      if (batch.cursor === from && batch.items.length === 0) break;
      await options.application.invokeRaw(
        {
          operation: options.syncOperation,
          input: options.toInput({
            ...(from === undefined ? {} : { from }),
            to: batch.cursor,
            items: batch.items,
          }),
          // Named by the operation too: one integration principal syncs several targets, and two
          // empty inbound syncs would otherwise send the same key for different commands.
          idempotencyKey: `sync:${options.syncOperation}:${from ?? ''}:${batch.cursor}`,
        },
        options.context,
      );
      batches++;
      items += batch.items.length;
      if (!batch.more) break;
    }
    return { batches, items };
  }
  return { target: options.port.describe().target, runOnce, ...createLoop(runOnce) };
}
