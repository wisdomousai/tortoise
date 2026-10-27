import { ApplicationError } from '@agent-native/contracts';
import { completeDelivery, targetHandlers } from '@agent-native/integration';
import { records, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { deliveries } from '../contracts/delivery';
import { erpTarget, type AsnLine } from '../contracts/erp-target';
import { requestInspection } from './quality-peer';
import { discrepant, type AppState } from '../domain';
import { handler, now, type Services } from './context';

/** The effect type of one goods receipt; the ERP port writes it as one CSV file. */
export const goodsReceipt = 'goods-receipt.post';

/** Posting goods receipts to the ERP, and the target's complete, feed and status handlers. */
export function erpHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.erpSend, (input, ctx) => {
      const store = records(ctx, deliveries, ctx.state.deliveries);
      const line = store.getExisting(input.id);
      if (line.counted === undefined)
        throw new ApplicationError('CONFLICT', 'Count the line before posting it');
      if (discrepant(line) && !line.reason)
        throw new ApplicationError('CONFLICT', 'Give the reason for the discrepancy first');
      // One receipt at a time per line, so a late outcome is never applied to a newer posting.
      if (line.posting && line.posting.sync !== 'rejected')
        throw new ApplicationError('CONFLICT', `Already ${line.posting.sync} by the ERP`);
      const effectId = ctx.enqueue({
        target: erpTarget.target,
        type: goodsReceipt,
        resource: deliveries.resource(line.id),
        payload: {
          delivery: line.id,
          purchaseOrder: line.purchaseOrder,
          sku: line.sku,
          counted: line.counted,
          reason: line.reason ?? '',
          note: line.note ?? '',
        },
      });
      // A line the ERP marked for inspection is sent once, and again after a refusal.
      const inspection =
        line.inspect && (!line.inspection || line.inspection.sync === 'rejected')
          ? requestInspection(ctx, line)
          : undefined;
      store.update(line.id, (record) => {
        record.status = 'posted';
        record.posting = { effectId, sync: 'pending' };
        if (inspection) record.inspection = { effectId: inspection, sync: 'pending' };
      });
      return { id: line.id, sync: 'pending' as const };
    }),
    ...targetHandlers<AppState, Services, AsnLine>(erpTarget, {
      cursor: (state) => state.sync.erp!,
      now,
      onOutcome(effect, outcome, ctx) {
        const id = effect.resource.slice('delivery:'.length);
        records(ctx, deliveries, ctx.state.deliveries).update(id, (record) => {
          completeDelivery(record.posting, effect, outcome);
          // A rejected receipt reopens the line, so it can be recounted and posted again.
          if (outcome.status === 'rejected') record.status = 'counted';
        });
      },
      applyBatch(batch, ctx) {
        const store = records(ctx, deliveries, ctx.state.deliveries);
        for (const line of batch.items)
          if (!store.has(line.id))
            store.insert(line.id, { ...line, status: 'expected', importedAt: now(ctx) });
          // A corrected notice updates a line nobody has counted yet; a counted one keeps its count.
          else if (store.get(line.id)!.status === 'expected') store.update(line.id, line);
        return batch.items.length;
      },
      status(ctx) {
        const postings = Object.values(ctx.state.deliveries).flatMap((line) =>
          line.posting ? [line.posting] : [],
        );
        const count = (sync: string) => postings.filter((entry) => entry.sync === sync).length;
        return {
          pending: count('pending'),
          accepted: count('accepted'),
          rejected: count('rejected'),
        };
      },
    }),
  ];
}
