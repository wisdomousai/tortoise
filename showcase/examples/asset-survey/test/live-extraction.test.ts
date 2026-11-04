import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { NetworkPort } from '@tortoise/host/plugin';
import type { Photo } from '../connectors/extractor';
import { modelExtractorFromEnv } from '../connectors/model-extractor';
import { plateTruth, samplePhoto, samplePlates } from '../fixtures/nameplates';

/**
 * Live, opt-in: reads the six sample plates with a real model and prints how its reading compares
 * with the ground truth. Runs only when `ASSET_SURVEY_MODEL` and `ASSET_SURVEY_MODEL_URL` (the base
 * URL a site would bind `model-api` to) are set, with `ASSET_SURVEY_MODEL_API_KEY` for a hosted
 * provider; nothing else is read. The photos go out without their text comment, so the model
 * sees pixels only. The comparison is printed, not asserted: record it in the implementation
 * status with the model and date.
 */
const env = process.env;
const configured = Boolean(env.ASSET_SURVEY_MODEL && env.ASSET_SURVEY_MODEL_URL);

/** A network port with one destination, `model-api`, at the configured URL. */
function modelApiOnly(base: string): NetworkPort {
  const root = base.endsWith('/') ? base : `${base}/`;
  return {
    client(destination: string) {
      if (destination !== 'model-api') throw new Error(`Undeclared destination ${destination}`);
      return { destination, fetch: (path, init) => fetch(new URL(String(path), root), init) };
    },
    routedFetch() {
      throw new Error('Not used by the model extractor');
    },
  } as NetworkPort;
}

/** The photo as a camera would deliver it: the leading `nameplate` comment segment removed. */
function pixelsOnly(jpeg: Uint8Array): Uint8Array {
  if (jpeg[2] !== 0xff || jpeg[3] !== 0xfe) return jpeg;
  const length = (jpeg[4]! << 8) | jpeg[5]!;
  return new Uint8Array([0xff, 0xd8, ...jpeg.subarray(4 + length)]);
}

const normal = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

test.skipIf(!configured)(
  'a live model reads the sample plates',
  async () => {
    const extractor = modelExtractorFromEnv(env)!(modelApiOnly(env.ASSET_SURVEY_MODEL_URL!));
    const rows: string[] = [];
    let matched = 0;
    let total = 0;
    for (const plate of samplePlates) {
      const data = pixelsOnly(await samplePhoto(plate));
      const photo: Photo = {
        ref: {
          digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
          size: data.length,
          mediaType: 'image/jpeg',
        },
        data,
      };
      const fields = await extractor.extract([photo], 'nameplate', AbortSignal.timeout(120_000));
      expect(Array.isArray(fields)).toBe(true);
      const read = new Map(fields.map((field) => [field.name, field]));
      for (const [name, shown] of Object.entries(plateTruth[plate])) {
        const hard = shown.endsWith(' ?');
        const truth = shown.replace(/ \?$/, '');
        const field = read.get(name);
        const same = field !== undefined && normal(field.value) === normal(truth);
        total++;
        if (same) matched++;
        rows.push(
          [
            plate,
            name,
            truth + (hard ? ' (hard)' : ''),
            field ? `${field.value} @${field.confidence.toFixed(2)}` : '-',
            same ? 'match' : field ? 'differs' : 'missing',
          ].join(' | '),
        );
      }
      for (const field of fields)
        if (!(field.name in plateTruth[plate]))
          rows.push(
            `${plate} | ${field.name} | - | ${field.value} @${field.confidence.toFixed(2)} | extra`,
          );
    }
    console.log(
      [
        `Model ${extractor.model}: ${matched} of ${total} values match the ground truth.`,
        'plate | field | shows | read | result',
        ...rows,
      ].join('\n'),
    );
  },
  600_000,
);
