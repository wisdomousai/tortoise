import type { z } from 'zod';
import type { BlobRef } from '@agent-native/contracts';
import type { PullBatch, SystemOfRecordPort } from '@agent-native/integration';
import type { Effect } from '@agent-native/runtime';
import type { proposalSchema } from '../contracts/extraction';
import type { ProposedField } from '../domain';
import { nameplateText } from './nameplate-photo';

export type Proposal = z.output<typeof proposalSchema>;
export interface Photo {
  readonly ref: BlobRef;
  readonly data: Uint8Array;
}

/** Reads values from a capture's photos. A live model implements this; so does the demo fake. */
export interface Extractor {
  readonly model: string;
  extract(photos: readonly Photo[], kind: string, signal: AbortSignal): Promise<ProposedField[]>;
}

/**
 * The demo extractor: reads the text a `nameplatePhoto` carries. Each `name: value` line becomes
 * a field read with confidence 0.96, or 0.55 when the line ends in ` ?`; the region is the line's
 * band on the plate. Any other image yields no fields, so a reviewer enters them by hand.
 */
export const nameplateTextExtractor: Extractor = {
  model: 'nameplate-text (demo)',
  async extract(photos) {
    return photos.flatMap(({ ref, data }) => {
      const lines = (nameplateText(data) ?? '').split('\n').filter((line) => line.includes(':'));
      return lines.map((line, index) => {
        const separator = line.indexOf(':');
        const raw = line.slice(separator + 1).trim();
        const unsure = raw.endsWith(' ?');
        return {
          name: line.slice(0, separator).trim(),
          value: unsure ? raw.slice(0, -2).trim() : raw,
          confidence: unsure ? 0.55 : 0.96,
          source: {
            digest: ref.digest,
            region: { x: 0.1, y: (8 + index * 7) / 56, width: 0.8, height: 3 / 56 },
          },
        };
      });
    });
  },
};

/**
 * The extraction model as a system of record. `deliver` reads the request's photos, asks the
 * extractor and keeps the proposal for the feed; delivering the same request again returns the
 * kept answer, so a retry never asks twice. `pull` hands out proposals in order.
 *
 * Proposals live in memory until the hub's sync applies them. If the host stops in between, the
 * request is settled but its proposal is lost, and the reviewer requests it again; an extractor
 * that runs as its own service keeps them.
 */
export function createExtractorPort(options: {
  readonly extractor: Extractor;
  readonly readBlob: (effect: Readonly<Effect>, digest: string) => Promise<Photo | undefined>;
}): SystemOfRecordPort<Proposal> & { readonly proposals: readonly Proposal[] } {
  const proposals: Proposal[] = [];
  const answered = new Map<string, number>();
  return {
    proposals,
    describe: () => ({ target: 'model', idempotentDelivery: true }),
    async deliver(effect, signal) {
      const known = answered.get(effect.id);
      if (known !== undefined) return { status: 'accepted', externalRef: `proposal-${known}` };
      const payload = effect.payload as unknown as {
        captureId: string;
        kind: string;
        photos: BlobRef[];
      };
      const photos: Photo[] = [];
      for (const ref of payload.photos) {
        const photo = await options.readBlob(effect, ref.digest);
        if (!photo)
          return {
            status: 'rejected',
            code: 'PHOTO_UNAVAILABLE',
            message: 'A photo of the capture is no longer stored',
          };
        photos.push(photo);
      }
      const fields = await options.extractor.extract(photos, payload.kind, signal);
      proposals.push({
        captureId: payload.captureId,
        effectId: effect.id,
        model: options.extractor.model,
        fields,
      });
      answered.set(effect.id, proposals.length);
      return { status: 'accepted', externalRef: `proposal-${proposals.length}` };
    },
    async pull(cursor): Promise<PullBatch<Proposal>> {
      const from = Number(cursor ?? 0);
      const items = proposals.slice(from, from + 50);
      return {
        items,
        cursor: String(from + items.length),
        more: from + items.length < proposals.length,
      };
    },
  };
}
