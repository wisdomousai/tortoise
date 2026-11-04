import type { Effect, EffectOutcome } from '@tortoise/runtime';
import { DeliveryFailure, type PullBatch, type SystemOfRecordPort } from '@tortoise/integration';
import type { Order, Reason } from './domain';

export type MesOrder = Omit<Order, 'status'> & { closed: boolean };
export type MesItem =
  | { readonly kind: 'order'; readonly order: MesOrder }
  | { readonly kind: 'reason'; readonly reason: Reason };

export interface MesFaults {
  /** Every delivery fails transiently, as if the MES or network were down. */
  unavailable?: boolean;
  /** The next delivery is booked but its response is lost (timeout after commit). */
  loseNextResponse?: boolean;
  reject?: (effect: Readonly<Effect>) => { code: string; message: string } | undefined;
}

/**
 * Deterministic stand-in for a homebrew MES. Like many in-house systems its booking endpoint is
 * not idempotent: every call creates a new booking. It does store the caller's reference with
 * each booking, so the dispatcher's lookup can find a booking whose response was lost before
 * sending again. It publishes orders and stop reasons as an ordered list. Not a protocol adapter.
 */
export class FakeMes implements SystemOfRecordPort<MesItem> {
  readonly bookings: { ref: string; effectId: string; type: string; payload: unknown }[] = [];
  faults: MesFaults = {};
  private readonly published: MesItem[] = [];
  private readonly orders = new Map<string, MesOrder>();

  constructor(seed: { orders: MesOrder[]; reasons: Reason[] } = demoSeed()) {
    for (const reason of seed.reasons) this.published.push({ kind: 'reason', reason });
    for (const order of seed.orders) this.publishOrder(order);
  }
  describe() {
    return { target: 'mes', idempotentDelivery: false } as const;
  }
  publishOrder(order: MesOrder): void {
    this.orders.set(order.id, structuredClone(order));
    this.published.push({ kind: 'order', order: structuredClone(order) });
  }
  closeOrder(id: string): void {
    const order = this.orders.get(id);
    if (order) this.publishOrder({ ...order, closed: true });
  }
  async pull(cursor: string | undefined): Promise<PullBatch<MesItem>> {
    const start = cursor === undefined ? 0 : Number(cursor);
    const items = this.published.slice(start, start + 50);
    return {
      items: structuredClone(items),
      cursor: String(start + items.length),
      more: start + items.length < this.published.length,
    };
  }
  async deliver(effect: Readonly<Effect>): Promise<EffectOutcome> {
    if (this.faults.unavailable) throw new DeliveryFailure('MES unavailable');
    const payload = effect.payload as { order?: string; reason?: string; good?: number };
    const order = payload.order ? this.orders.get(payload.order) : undefined;
    const rejection =
      this.faults.reject?.(effect) ??
      (effect.type === 'count.post' && order?.closed
        ? { code: 'ORDER_CLOSED', message: `Order ${order.id} is closed in the MES` }
        : effect.type === 'count.post' &&
            payload.good !== undefined &&
            this.lastGood(payload.order) > payload.good
          ? { code: 'COUNT_DECREASED', message: 'Good count is lower than the last booking' }
          : undefined);
    if (rejection) return { status: 'rejected', ...rejection };
    const ref = `MES-${String(this.bookings.length + 1).padStart(5, '0')}`;
    this.bookings.push({
      ref,
      effectId: effect.id,
      type: effect.type,
      payload: structuredClone(effect.payload),
    });
    if (this.faults.loseNextResponse) {
      this.faults.loseNextResponse = false;
      throw new DeliveryFailure('MES did not respond in time');
    }
    return { status: 'accepted', externalRef: ref };
  }
  /** Finds a booking by the caller reference stored with it. */
  async lookup(effectId: string): Promise<EffectOutcome | undefined> {
    const booking = this.bookings.find((candidate) => candidate.effectId === effectId);
    return booking ? { status: 'accepted', externalRef: booking.ref } : undefined;
  }
  private lastGood(order: string | undefined): number {
    const counts = this.bookings
      .filter(
        (booking) =>
          booking.type === 'count.post' && (booking.payload as { order?: string }).order === order,
      )
      .map((booking) => (booking.payload as { good: number }).good);
    return counts.length ? Math.max(...counts) : -Infinity;
  }
}

/** Map a pulled change batch to the domain's sync command input. */
export function toSyncInput(batch: {
  readonly from?: string;
  readonly to: string;
  readonly items: readonly MesItem[];
}) {
  return {
    ...(batch.from === undefined ? {} : { from: batch.from }),
    to: batch.to,
    items: batch.items.flatMap((item) => (item.kind === 'order' ? [item.order] : [])),
    reasons: batch.items.flatMap((item) => (item.kind === 'reason' ? [item.reason] : [])),
  };
}

/** Two winding orders for winder-1 and the MES stop reason catalog. */
export function demoSeed(): { orders: MesOrder[]; reasons: Reason[] } {
  return {
    reasons: [
      { code: 'MAT', text: 'Material shortage', category: 'unplanned' },
      { code: 'WIRE', text: 'Wire break', category: 'unplanned' },
      { code: 'ELEC', text: 'Electrical fault', category: 'unplanned' },
      { code: 'MECH', text: 'Mechanical fault', category: 'unplanned' },
      { code: 'CHG', text: 'Changeover', category: 'planned' },
      { code: 'CLN', text: 'Cleaning', category: 'planned' },
      { code: 'BRK', text: 'Break', category: 'planned' },
      { code: 'QHLD', text: 'Quality hold', category: 'quality' },
      { code: 'ADJ', text: 'Adjustment after quality check', category: 'quality' },
    ],
    orders: [
      {
        id: 'ORD-7001',
        station: 'winder-1',
        material: 'CT-250',
        materialText: 'Coil for 250 VA control transformer',
        recipe: 'R-250',
        quantity: 12000,
        closed: false,
      },
      {
        id: 'ORD-7002',
        station: 'winder-1',
        material: 'CT-100',
        materialText: 'Coil for 100 VA control transformer',
        recipe: 'R-100',
        quantity: 8000,
        closed: false,
      },
    ],
  };
}
