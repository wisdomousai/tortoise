import type { BlobRef } from '@agent-native/contracts';
import { assignmentTargetPort } from '@agent-native/assignments/server';
import type { extraction } from '../contracts/kinds';
import type { ProposedField } from '../domain';
import { nameplateText } from './nameplate-photo';

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
 * The demo extractor: reads the text a `nameplatePhoto` or a sample photo carries. Each
 * `name: value` line becomes a field read with confidence 0.96, or 0.55 when the line ends in
 * ` ?`; on a stand-in, the region is the line's band on the plate. Any other image yields no
 * fields, so a reviewer enters them by hand.
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
            // Only the stand-in's geometry is known; a real photo's text has no position.
            ...(ref.mediaType === 'image/png'
              ? { region: { x: 0.1, y: (8 + index * 7) / 56, width: 0.8, height: 3 / 56 } }
              : {}),
          },
        };
      });
    });
  },
};

/**
 * The extraction model as the assignments' `model` target lane: each offer carries one
 * capture's photos, and the port answers with one reading. A photo no longer stored refuses the
 * offer, which the planner sees on the extraction. The lane port keeps answers in memory until
 * the hub syncs them (see `assignmentTargetPort`).
 */
export function createExtractionPort(options: {
  readonly extractor: Extractor;
  readonly readBlob: (effectId: string, digest: string) => Promise<Photo | undefined>;
}) {
  return assignmentTargetPort<typeof extraction>({
    lane: 'model',
    readBlob: options.readBlob,
    async work(offer, { readBlob, signal }) {
      const photos: Photo[] = [];
      for (const ref of offer.brief.photos) {
        const photo = await readBlob(ref.digest);
        if (!photo)
          return {
            refused: {
              code: 'PHOTO_UNAVAILABLE',
              message: 'A photo of the capture is no longer stored',
            },
          };
        photos.push(photo);
      }
      const fields = await options.extractor.extract(photos, offer.brief.kind, signal);
      return [{ body: { model: options.extractor.model, fields } }];
    },
  });
}
export type ExtractionPort = ReturnType<typeof createExtractionPort>;
