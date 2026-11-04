import type { BlobRef } from '@tortoise/contracts';
import {
  DeliveryFailure,
  type CallerCredentials,
  type PullBatch,
  type SearchPage,
  type SystemOfRecordPort,
} from '@tortoise/integration';
import type { Effect, EffectOutcome, SourceRequest } from '@tortoise/runtime';

/** How the EAM reads an evidence photo of the filing it is delivering. */
export type EvidenceReader = (
  effect: Readonly<Effect>,
  digest: string,
) => Promise<{ data: Uint8Array } | undefined>;

/** An asset in the EAM's own terms. */
export interface EamAsset {
  externalId: string;
  designation: string;
  name: string;
  attributes: Record<string, string>;
  /** Digests of the evidence photos attached to the asset. */
  evidence: string[];
  status: 'active' | 'retired';
}
export interface AssetChange {
  externalId: string;
  designation: string;
  status: 'active' | 'retired';
}

/** Assets the demo EAM already holds: one breaker filed before the survey, one retired relay. */
export function demoAssets(): EamAsset[] {
  return [
    {
      externalId: 'EAM-1001',
      designation: '=G1-Q1',
      name: 'Generator circuit breaker',
      attributes: { manufacturer: 'ABB', serial: '1VYN300101' },
      evidence: [],
      status: 'active',
    },
    {
      externalId: 'EAM-1002',
      designation: '=G1-F2',
      name: 'Overcurrent relay (removed 2019)',
      attributes: { manufacturer: 'Siemens' },
      evidence: [],
      status: 'retired',
    },
  ];
}

const SERVICE = 'service';
const compact = (text: string) => text.replaceAll(' ', '').toUpperCase();

/**
 * Deterministic in-memory EAM for the demo and tests. It refuses to create an asset without a
 * serial number or with the designation of an active asset, attaches the photos it is sent as
 * evidence, and reports every created or updated asset on its feed. Delivery is idempotent by
 * effect ID. A withdrawal retires the asset a filing created, or restores what a filing replaced
 * on an asset it updated. Searches use the integration's service account. `unavailable` makes
 * every call fail transiently.
 */
export class FakeEam implements SystemOfRecordPort<AssetChange, string> {
  unavailable = false;
  readonly assets = new Map<string, EamAsset>();
  private readonly outcomes = new Map<string, EffectOutcome>();
  /** What each update replaced, by its effect ID, so a withdrawal can restore it. */
  private readonly replaced = new Map<string, Pick<EamAsset, 'name' | 'attributes' | 'evidence'>>();
  private readonly changes: AssetChange[] = [];
  private next = 2001;

  constructor(
    private readonly readBlob: EvidenceReader = async () => undefined,
    seed: EamAsset[] = demoAssets(),
  ) {
    for (const asset of seed) this.assets.set(asset.externalId, asset);
  }

  readonly credentials: CallerCredentials<string> = {
    forPrincipal: async () => undefined,
    service: async () => SERVICE,
  };

  describe() {
    return { target: 'eam', idempotentDelivery: true };
  }

  async deliver(effect: Readonly<Effect>): Promise<EffectOutcome> {
    if (this.unavailable) throw new DeliveryFailure('The EAM is not reachable');
    const known = this.outcomes.get(effect.id);
    if (known) return known;
    const outcome = await this.apply(effect);
    this.outcomes.set(effect.id, outcome);
    return outcome;
  }

  private withdraw(payload: { assetId: string; revert: string; created: boolean }): EffectOutcome {
    const asset = this.assets.get(payload.assetId);
    const before = this.replaced.get(payload.revert);
    if (!asset || (!payload.created && !before))
      return {
        status: 'rejected',
        code: 'ASSET_UNKNOWN',
        message: `Nothing to withdraw from ${payload.assetId}`,
      };
    if (payload.created) asset.status = 'retired';
    else Object.assign(asset, structuredClone(before));
    this.changes.push({
      externalId: asset.externalId,
      designation: asset.designation,
      status: asset.status,
    });
    return { status: 'accepted', externalRef: asset.externalId };
  }

  private async apply(effect: Readonly<Effect>): Promise<EffectOutcome> {
    if (effect.type === 'asset.withdraw')
      return this.withdraw(
        effect.payload as unknown as { assetId: string; revert: string; created: boolean },
      );
    const payload = effect.payload as unknown as {
      assetId?: string;
      designation: string;
      name: string;
      attributes: Record<string, string>;
      photos: BlobRef[];
    };
    const evidence: string[] = [];
    for (const photo of payload.photos) {
      // A photo that cannot be read now is transient: the hub still holds it.
      if (!(await this.readBlob(effect, photo.digest)))
        throw new DeliveryFailure('An evidence photo could not be read');
      evidence.push(photo.digest);
    }
    if (payload.assetId) {
      const asset = this.assets.get(payload.assetId);
      if (!asset || asset.status === 'retired')
        return {
          status: 'rejected',
          code: 'ASSET_UNKNOWN',
          message: `No active asset ${payload.assetId}`,
        };
      this.replaced.set(
        effect.id,
        structuredClone({
          name: asset.name,
          attributes: asset.attributes,
          evidence: asset.evidence,
        }),
      );
      Object.assign(asset.attributes, payload.attributes);
      asset.evidence.push(...evidence);
      asset.name = payload.name;
      this.changes.push({
        externalId: asset.externalId,
        designation: asset.designation,
        status: asset.status,
      });
      return { status: 'accepted', externalRef: asset.externalId };
    }
    if (!payload.attributes.serial)
      return {
        status: 'rejected',
        code: 'SERIAL_REQUIRED',
        message: 'The EAM needs a serial number to register an asset',
      };
    const clash = [...this.assets.values()].find(
      (asset) =>
        asset.status === 'active' && compact(asset.designation) === compact(payload.designation),
    );
    if (clash)
      return {
        status: 'rejected',
        code: 'DUPLICATE_DESIGNATION',
        message: `Asset ${clash.externalId} already has ${clash.designation}; file with its asset ID to update it`,
      };
    const externalId = `EAM-${this.next++}`;
    this.assets.set(externalId, {
      externalId,
      designation: payload.designation,
      name: payload.name,
      attributes: { ...payload.attributes },
      evidence,
      status: 'active',
    });
    this.changes.push({ externalId, designation: payload.designation, status: 'active' });
    return { status: 'accepted', externalRef: externalId };
  }

  async pull(cursor: string | undefined): Promise<PullBatch<AssetChange>> {
    if (this.unavailable) throw new DeliveryFailure('The EAM is not reachable');
    const from = Number(cursor ?? 0);
    const items = this.changes.slice(from, from + 200);
    return {
      items,
      cursor: String(from + items.length),
      more: from + items.length < this.changes.length,
    };
  }

  /** Retire an asset in the EAM, as its own users would; the feed reports it. */
  retire(externalId: string) {
    const asset = this.assets.get(externalId)!;
    asset.status = 'retired';
    this.changes.push({ externalId, designation: asset.designation, status: 'retired' });
  }

  async search(request: SourceRequest): Promise<SearchPage> {
    if (this.unavailable) throw new DeliveryFailure('The EAM is not reachable');
    const query = request.query as { q?: string; externalId?: string; limit?: number };
    const item = (asset: EamAsset) => ({
      externalId: asset.externalId,
      designation: asset.designation,
      name: asset.name,
      ...(asset.attributes.manufacturer ? { manufacturer: asset.attributes.manufacturer } : {}),
      ...(asset.attributes.serial ? { serial: asset.attributes.serial } : {}),
    });
    const active = [...this.assets.values()].filter((asset) => asset.status === 'active');
    if (request.operation === 'eam.asset.lookup')
      return { items: active.filter((asset) => asset.externalId === query.externalId).map(item) };
    const q = (query.q ?? '').trim().toLowerCase();
    return {
      items: active
        .filter(
          (asset) =>
            !q ||
            compact(asset.designation).startsWith(compact(q)) ||
            asset.name.toLowerCase().includes(q) ||
            (asset.attributes.serial ?? '').toLowerCase() === q,
        )
        .slice(0, query.limit ?? 20)
        .map(item),
    };
  }
}
