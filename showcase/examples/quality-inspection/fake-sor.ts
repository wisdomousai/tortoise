import type { z } from 'zod';
import type { Effect, EffectOutcome } from '@tortoise/runtime';
import { DeliveryFailure, type PullBatch, type SystemOfRecordPort } from '@tortoise/integration';
import type { codeGroupSchema, lotSnapshotSchema } from './contracts';

export type LotSnapshot = z.infer<typeof lotSnapshotSchema>;
export type CodeGroupSnapshot = z.infer<typeof codeGroupSchema>;
export type QualityItem =
  | { readonly kind: 'lot'; readonly lot: LotSnapshot }
  | { readonly kind: 'codeGroup'; readonly group: CodeGroupSnapshot };

export interface FakeFaults {
  /** Every delivery fails transiently, as if the SoR or network were down. */
  unavailable?: boolean;
  latencyMs?: number;
  /** Return a business rejection for matching effects. */
  reject?: (effect: Readonly<Effect>) => { code: string; message: string } | undefined;
}

/**
 * Deterministic in-memory stand-in for an external quality system (for example an ERP quality
 * module). It publishes lots and code catalogs as an ordered change feed, accepts forwarded
 * documents idempotently by effect ID, and enforces a few SoR-side rules the capture app cannot
 * see locally (a lot locked in the SoR). Tests and the demo use it; it is not a protocol adapter.
 */
export class FakeQualitySystem implements SystemOfRecordPort<QualityItem> {
  readonly documents = new Map<string, { type: string; payload: unknown; ref: string }>();
  readonly deliveries: string[] = [];
  faults: FakeFaults = {};
  private readonly feed: QualityItem[] = [];
  private readonly lots = new Map<string, LotSnapshot>();
  private readonly locked = new Set<string>();

  constructor(seed: { lots: LotSnapshot[]; codeGroups: CodeGroupSnapshot[] } = demoSeed()) {
    for (const group of seed.codeGroups) this.feed.push({ kind: 'codeGroup', group });
    for (const lot of seed.lots) this.publishLot(lot);
  }
  describe() {
    return { target: 'quality-system', idempotentDelivery: true } as const;
  }
  /** Publish a new or changed lot to the change feed. */
  publishLot(lot: LotSnapshot): void {
    this.lots.set(lot.id, structuredClone(lot));
    this.feed.push({ kind: 'lot', lot: structuredClone(lot) });
  }
  closeLot(id: string): void {
    const lot = this.lots.get(id);
    if (lot) this.publishLot({ ...lot, closed: true });
  }
  /** Simulate a lock held by another SoR user; forwarded documents for the lot are rejected. */
  lock(id: string, locked = true): void {
    if (locked) this.locked.add(id);
    else this.locked.delete(id);
  }
  async pull(cursor: string | undefined, signal: AbortSignal): Promise<PullBatch<QualityItem>> {
    await this.wait(signal);
    const start = cursor === undefined ? 0 : Number(cursor);
    const items = this.feed.slice(start, start + 50);
    return {
      items: structuredClone(items),
      cursor: String(start + items.length),
      more: start + items.length < this.feed.length,
    };
  }
  async deliver(effect: Readonly<Effect>, signal: AbortSignal): Promise<EffectOutcome> {
    this.deliveries.push(effect.id);
    await this.wait(signal);
    if (this.faults.unavailable) throw new DeliveryFailure('Quality system unavailable');
    // Idempotent by effect ID: a redelivery returns the original document reference.
    const existing = this.documents.get(effect.id);
    if (existing) return { status: 'accepted', externalRef: existing.ref };
    const payload = effect.payload as { lot?: string };
    const lotId = payload.lot ?? '';
    const rejection =
      this.faults.reject?.(effect) ??
      (this.locked.has(lotId)
        ? { code: 'LOT_LOCKED', message: `Inspection lot ${lotId} is locked by another user` }
        : this.lots.get(lotId)?.closed
          ? { code: 'LOT_CLOSED', message: `Inspection lot ${lotId} is closed` }
          : undefined);
    if (rejection) return { status: 'rejected', ...rejection };
    const ref = `QM-${String(this.documents.size + 1).padStart(6, '0')}`;
    this.documents.set(effect.id, {
      type: effect.type,
      payload: structuredClone(effect.payload),
      ref,
    });
    return { status: 'accepted', externalRef: ref };
  }
  async lookup(effectId: string): Promise<EffectOutcome | undefined> {
    const existing = this.documents.get(effectId);
    return existing ? { status: 'accepted', externalRef: existing.ref } : undefined;
  }
  private async wait(signal: AbortSignal): Promise<void> {
    if (!this.faults.latencyMs) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.faults.latencyMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DeliveryFailure('Delivery cancelled'));
        },
        { once: true },
      );
    });
  }
}

/** Map a pulled change batch to the domain's sync command input. */
export function toSyncInput(batch: {
  readonly from?: string;
  readonly to: string;
  readonly items: readonly QualityItem[];
}) {
  return {
    ...(batch.from === undefined ? {} : { from: batch.from }),
    to: batch.to,
    items: batch.items.flatMap((item) => (item.kind === 'lot' ? [item.lot] : [])),
    codeGroups: batch.items.flatMap((item) => (item.kind === 'codeGroup' ? [item.group] : [])),
  };
}

/** Brake-component inspection lots at two plants, with qualitative and defect code catalogs. */
export function demoSeed(): { lots: LotSnapshot[]; codeGroups: CodeGroupSnapshot[] } {
  return {
    codeGroups: [
      {
        id: 'SURFACE',
        codes: [
          { code: 'OK', text: 'Within finish specification', valuation: 'accepted' },
          { code: 'SCR', text: 'Scratches', valuation: 'rejected' },
          { code: 'POR', text: 'Porosity', valuation: 'rejected' },
        ],
      },
      {
        id: 'VISUAL',
        codes: [
          { code: 'OK', text: 'No visible damage', valuation: 'accepted' },
          { code: 'DMG', text: 'Visible damage', valuation: 'rejected' },
        ],
      },
      {
        id: 'defects',
        codes: [
          { code: 'D01', text: 'Dimensional deviation', valuation: 'rejected' },
          { code: 'D02', text: 'Surface damage', valuation: 'rejected' },
          { code: 'D03', text: 'Contamination', valuation: 'rejected' },
        ],
      },
    ],
    lots: [
      {
        id: '4000001',
        plant: 'P100',
        material: 'BRK-220',
        materialText: 'Brake disc 220 mm',
        batch: 'B2410-07',
        quantity: 120,
        unit: 'PC',
        closed: false,
        characteristics: [
          {
            id: 'C10',
            code: 'DIAM',
            text: 'Outer diameter',
            kind: 'quantitative',
            unit: 'mm',
            target: 220,
            lower: 219.9,
            upper: 220.1,
            decimals: 2,
            sampleSize: 3,
          },
          {
            id: 'C20',
            code: 'THICK',
            text: 'Disc thickness',
            kind: 'quantitative',
            unit: 'mm',
            target: 22,
            lower: 21.95,
            upper: 22.05,
            decimals: 2,
            sampleSize: 3,
          },
          {
            id: 'C30',
            code: 'RUNOUT',
            text: 'Lateral runout',
            kind: 'quantitative',
            unit: 'mm',
            upper: 0.05,
            decimals: 3,
            sampleSize: 2,
          },
          {
            id: 'C40',
            code: 'SURF',
            text: 'Surface finish',
            kind: 'qualitative',
            codeGroup: 'SURFACE',
            sampleSize: 1,
          },
        ],
      },
      {
        id: '4000002',
        plant: 'P100',
        material: 'HUB-88',
        materialText: 'Wheel hub 88 mm bore',
        batch: 'B2410-11',
        quantity: 60,
        unit: 'PC',
        closed: false,
        characteristics: [
          {
            id: 'C10',
            code: 'BORE',
            text: 'Bore diameter',
            kind: 'quantitative',
            unit: 'mm',
            target: 88,
            lower: 87.98,
            upper: 88.02,
            decimals: 3,
            sampleSize: 5,
          },
          {
            id: 'C20',
            code: 'VIS',
            text: 'Visual inspection',
            kind: 'qualitative',
            codeGroup: 'VISUAL',
            sampleSize: 1,
          },
        ],
      },
      {
        id: '4000003',
        plant: 'P200',
        material: 'BRK-300',
        materialText: 'Brake disc 300 mm',
        quantity: 40,
        unit: 'PC',
        closed: false,
        characteristics: [
          {
            id: 'C10',
            code: 'DIAM',
            text: 'Outer diameter',
            kind: 'quantitative',
            unit: 'mm',
            target: 300,
            lower: 299.9,
            upper: 300.1,
            decimals: 2,
            sampleSize: 2,
          },
        ],
      },
    ],
  };
}
