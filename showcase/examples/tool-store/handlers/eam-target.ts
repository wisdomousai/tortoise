import { completeDelivery, targetHandlers } from '@agent-native/integration';
import {
  own,
  records,
  type Effect,
  type EffectOutcome,
  type HandlerContribution,
} from '@agent-native/runtime';
import { eamTarget, type EamTool } from '../contracts/eam-target';
import { loans } from '../contracts/loan';
import { tools } from '../contracts/tool';
import type { AppState } from '../domain';
import { now, type Context, type Services } from './context';

/** The loan whose damaged return sent `effect`, or undefined for any other effect. */
function forwardingLoan(effect: Effect, ctx: Context) {
  const prefix = `${loans.type}:`;
  if (effect.target !== eamTarget.target || !effect.resource.startsWith(prefix)) return undefined;
  return own(ctx.state.loans, effect.resource.slice(prefix.length));
}

/**
 * Record the EAM's answer on the loan that sent the repair order: the repair order number when it
 * accepted, the code and message when it refused. `completeDelivery` refuses with `NOT_FOUND` when
 * the loan sent a different effect, so an outcome is never recorded on the wrong repair order.
 */
function recordOutcome(effect: Effect, outcome: EffectOutcome, ctx: Context) {
  completeDelivery(forwardingLoan(effect, ctx)?.repairOrder, effect, outcome);
}

/**
 * The reconciliation feature's `onResolved` hook. It commits with a person's decision on a held
 * repair order: applied and refused record the outcome as the dispatcher's completion would.
 * Not applied releases the effect for another delivery, so the loan stays pending.
 */
export function recordReconciled(effect: Effect, outcome: EffectOutcome | undefined, ctx: Context) {
  if (outcome && effect.target === eamTarget.target) recordOutcome(effect, outcome, ctx);
}

/**
 * Apply EAM master data to the tools the store holds, matched by asset tag. Only description,
 * category, bin and calibration date change; status belongs to the counter. A tag the store does
 * not hold is skipped: the attendant adds a tool when it comes to the store.
 */
function applyTools(items: readonly EamTool[], ctx: Context) {
  const rows = records(ctx, tools, ctx.state.tools);
  const byTag = new Map(rows.values().map((tool) => [tool.assetTag, tool.id]));
  let changed = 0;
  for (const item of items) {
    const id = byTag.get(item.assetTag);
    if (id === undefined) continue;
    rows.update(id, (tool) => {
      tool.description = item.description;
      tool.category = item.category;
      tool.bin = item.bin;
      // The EAM plans calibration, so a date it no longer sends is cleared here.
      if (item.calibrationDue === undefined) delete tool.calibrationDue;
      else tool.calibrationDue = item.calibrationDue;
    });
    changed++;
  }
  return changed;
}

/** The EAM target's complete, sync and status handlers. */
export function eamHandlers(): HandlerContribution<AppState, Services>[] {
  return targetHandlers<AppState, Services, EamTool>(eamTarget, {
    cursor: (state) => state.sync[eamTarget.target]!,
    now,
    onOutcome: recordOutcome,
    // The feed can replay an older version of an asset after a newer one, so each item is
    // checked against the last version applied for its asset tag before `applyBatch` sees it.
    versions: {
      store: (state) => state.eamVersions,
      of: (item) => ({ key: item.assetTag, version: item.version }),
    },
    applyBatch: (batch, ctx) => applyTools(batch.items, ctx),
    // Every member sees every loan, so the counts need no scoping beyond the caller gate.
    status(ctx) {
      const orders = Object.values(ctx.state.loans).flatMap((loan) =>
        loan.repairOrder ? [loan.repairOrder] : [],
      );
      const count = (sync: string) => orders.filter((order) => order.sync === sync).length;
      const held = ctx.effects({ status: 'pending', held: true, target: eamTarget.target });
      return {
        pending: count('pending'),
        held: held.length,
        accepted: count('accepted'),
        rejected: count('rejected'),
      };
    },
  });
}
