import type { Effect, EffectOutcome } from '@agent-native/runtime';
import {
  DeliveryFailure,
  type DeliveryResult,
  type LookupResult,
  type PullBatch,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import { repairOrderEffect, type EamTool, type RepairOrderPayload } from './contracts/eam-target';

/** A repair order the fake EAM opened, with the effect ID as its external reference. */
export interface EamRepairOrder {
  number: string;
  reference: string;
  assetTag: string;
  note?: string;
  reportedBy: string;
}

export interface FakeEamOptions {
  /** Asset tags the EAM does not know: a repair order for one is refused with ASSET_UNKNOWN. */
  unknownTags?: Iterable<string>;
  /** The most feed items one pull returns. Default 100, the target's batch limit. */
  pageSize?: number;
}

/** Asset tags from a comma-separated list such as `DEMO_EAM_UNKNOWN_TAGS=TC-00601,TC-00602`. */
export function tagList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * Demo and test stand-in for the plant EAM and its connector, in memory and deterministic: repair
 * order numbers count up from RO-000001, and nothing depends on the clock or chance.
 *
 * The EAM opens a repair order for every request it receives, so delivery is not idempotent. Its
 * interface log records each request under the reference it included (the effect ID) with the
 * answer, and `lookup` reads that log before the dispatcher sends again: no entry means the
 * request never reached the EAM, an answer means it was decided, and an entry without an answer
 * means the EAM may have opened the order, so the dispatcher holds the effect for a person. Once
 * that person released it (the EAM opened no order), the same entry no longer holds it.
 *
 * Pass a real connector as `createToolStoreApplication({ eam: port })`. It reaches the EAM through
 * the network port and the `eam-api` destination.
 */
export class FakeEam implements SystemOfRecordPort<EamTool> {
  private readonly orders: EamRepairOrder[] = [];
  private readonly log = new Map<string, { result?: EffectOutcome }>();
  private readonly feed: EamTool[] = [];
  private readonly unknownTags: ReadonlySet<string>;
  private readonly pageSize: number;
  private failing = false;
  private losing: { opened: boolean } | undefined;

  constructor(options: FakeEamOptions = {}) {
    this.unknownTags = new Set(options.unknownTags ?? []);
    this.pageSize = options.pageSize ?? 100;
  }

  describe() {
    return { target: 'eam', idempotentDelivery: false } as const;
  }

  async deliver(effect: Readonly<Effect>, signal: AbortSignal): Promise<DeliveryResult> {
    if (signal.aborted) throw new DeliveryFailure('The delivery to the EAM was cancelled');
    if (this.failing) {
      this.failing = false;
      throw new DeliveryFailure('The EAM is not reachable');
    }
    const losing = this.losing;
    if (losing) {
      // The connection broke off while the EAM processed the request: the interface log has no
      // answer, so neither the reply nor the lookup can tell whether the order exists.
      this.losing = undefined;
      if (losing.opened) this.receive(effect);
      this.log.set(effect.id, {});
      throw new DeliveryFailure('The EAM did not answer the repair order request');
    }
    const outcome = this.receive(effect);
    this.log.set(effect.id, { result: outcome });
    return outcome;
  }

  async lookup(effectId: string, _signal: AbortSignal, effect?: Readonly<Effect>) {
    const entry = this.log.get(effectId);
    if (entry === undefined) return undefined;
    if (entry.result) return entry.result;
    // A person checked the EAM and found no order, so the missing answer no longer holds it.
    if (effect?.releasedAt !== undefined) return undefined;
    const tag = (effect?.payload as Partial<RepairOrderPayload> | undefined)?.assetTag;
    return {
      status: 'uncertain',
      reason: `The EAM received the repair order request${tag ? ` for ${tag}` : ''} but recorded no answer. Check its repair orders before deciding.`,
    } satisfies LookupResult;
  }

  async pull(cursor: string | undefined): Promise<PullBatch<EamTool>> {
    const from = Number(cursor ?? 0);
    if (!Number.isInteger(from) || from < 0 || from > this.feed.length)
      throw new DeliveryFailure('The EAM does not know this feed position');
    const items = this.feed.slice(from, from + this.pageSize);
    const to = from + items.length;
    return { items: structuredClone(items), cursor: String(to), more: to < this.feed.length };
  }

  /** The EAM changes the master data of one asset; the next pull returns it. */
  publish(item: EamTool) {
    this.feed.push(structuredClone(item));
  }

  /** The next delivery fails before it reaches the EAM. */
  failNext() {
    this.failing = true;
  }

  /**
   * The next delivery reaches the EAM and its answer is lost. `opened` says whether the EAM opened
   * the repair order before the connection broke off; it does by default.
   */
  loseNextReply({ opened = true }: { opened?: boolean } = {}) {
    this.losing = { opened };
  }

  /** The repair orders the EAM opened, oldest first. */
  get repairOrders(): readonly EamRepairOrder[] {
    return structuredClone(this.orders);
  }

  /** The EAM's decision on one request: it opens a repair order for an asset it knows. */
  private receive(effect: Readonly<Effect>): EffectOutcome {
    if (effect.type !== repairOrderEffect)
      return {
        status: 'rejected',
        code: 'UNSUPPORTED',
        message: `The EAM takes no ${effect.type}`,
      };
    const payload = effect.payload as RepairOrderPayload;
    if (this.unknownTags.has(payload.assetTag))
      return {
        status: 'rejected',
        code: 'ASSET_UNKNOWN',
        message: `The EAM has no asset ${payload.assetTag}`,
      };
    const number = `RO-${String(this.orders.length + 1).padStart(6, '0')}`;
    this.orders.push({
      number,
      reference: effect.id,
      assetTag: payload.assetTag,
      ...(payload.note === undefined ? {} : { note: payload.note }),
      reportedBy: payload.returnedBy,
    });
    return { status: 'accepted', externalRef: number };
  }
}
