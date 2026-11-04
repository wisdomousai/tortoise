import { z } from 'zod';
import { implementDataProvider, completeDelivery, targetHandlers } from '@tortoise/integration';
import { own, records, type HandlerContribution } from '@tortoise/runtime';
import {
  inspectionRequestOperations,
  type ClosedInspectionRequest,
} from '@tortoise/quality-inspection/contracts/peer';
import { deliveries, type Delivery } from '../contracts/delivery';
import { qualityLots, qualityPeer } from '../contracts/quality-peer';
import type { AppState } from '../domain';
import { now, type Context, type Services } from './context';

/**
 * Enqueue an inspection request for a counted line in quality inspection, in the posting's transaction.
 * The peer's own input schema checks the payload here, so a line it would refuse fails the post.
 */
export function requestInspection(ctx: Context, line: Delivery): string {
  return ctx.enqueue(
    qualityPeer.effect(inspectionRequestOperations.inspectionRequestCreate, {
      resource: deliveries.resource(line.id),
      payload: {
        delivery: line.id,
        purchaseOrder: line.purchaseOrder,
        supplier: line.supplier,
        sku: line.sku,
        description: line.description,
        quantity: line.counted ?? line.expected,
      },
    }),
  );
}

/**
 * What quality inspection's lot list returns, as far as this application shows it. Parsed here
 * because the peer is outside this application's trust: a malformed lot is dropped.
 */
const lotRecord = z.object({
  id: z.string(),
  plant: z.string(),
  material: z.string(),
  materialText: z.string(),
  batch: z.string().optional(),
  quantity: z.number(),
  unit: z.string(),
  status: z.enum(['open', 'decided', 'closed']),
});

/** The quality target's complete, inbound sync and status handlers, and the live lot search. */
export function qualityHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    ...targetHandlers<AppState, Services, ClosedInspectionRequest>(qualityPeer, {
      cursor: (state) => state.sync.quality!,
      now,
      onOutcome(effect, outcome, ctx) {
        const id = effect.resource.slice('delivery:'.length);
        records(ctx, deliveries, ctx.state.deliveries).update(id, (record) =>
          completeDelivery(record.inspection, effect, outcome),
        );
      },
      applyBatch(batch, ctx) {
        const store = records(ctx, deliveries, ctx.state.deliveries);
        let applied = 0;
        for (const result of batch.items) {
          // Only the request this line sent last; an older one's outcome is stale.
          if (own(ctx.state.deliveries, result.delivery)?.inspection?.sorRef !== result.id)
            continue;
          store.update(result.delivery, (record) => {
            record.inspection!.outcome = result.outcome;
            if (result.note) record.inspection!.note = result.note;
            else delete record.inspection!.note;
          });
          applied++;
        }
        return applied;
      },
      status(ctx) {
        const inspections = Object.values(ctx.state.deliveries).flatMap((line) =>
          line.inspection ? [line.inspection] : [],
        );
        const count = (test: (entry: (typeof inspections)[number]) => boolean) =>
          inspections.filter(test).length;
        return {
          pending: count((entry) => entry.sync === 'pending'),
          rejected: count((entry) => entry.sync === 'rejected'),
          inspecting: count((entry) => entry.sync === 'accepted' && !entry.outcome),
          passed: count((entry) => entry.outcome === 'accepted'),
          failed: count((entry) => entry.outcome === 'rejected'),
        };
      },
    }),
    ...implementDataProvider<AppState, Services, typeof qualityLots>(qualityLots, {
      item(found) {
        const lot = lotRecord.safeParse(found);
        if (!lot.success) return undefined;
        const { id, ...rest } = lot.data;
        return { externalId: id, ...rest };
      },
    }),
  ];
}
