import { readFile } from 'node:fs/promises';
import truth from './nameplates/ground-truth.json' with { type: 'json' };

/**
 * Six generated photos of nameplates by fictional manufacturers, 768 px JPEGs. Each carries what
 * it shows as a `nameplate` comment, so the demo extractor reads them deterministically, and
 * `ground-truth.json` holds the same values for comparing a live model's reading. Two plates are
 * hard to read on purpose: the valve's serial is rusted and the compressor's model and power
 * are faded; their values end in ` ?`. Server and tests only.
 */
export const samplePlates = [
  'motor',
  'pump',
  'transformer',
  'breaker',
  'valve',
  'compressor',
] as const;
export type SamplePlate = (typeof samplePlates)[number];

/** What each plate shows, by attribute name; ` ?` marks a value that is hard to read. */
export const plateTruth = truth as unknown as Readonly<
  Record<SamplePlate, Readonly<Record<string, string>>>
>;

/** One plate's JPEG bytes. Works under Bun and under Playwright's Node runner. */
export async function samplePhoto(plate: SamplePlate): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`./nameplates/${plate}.jpg`, import.meta.url)));
}
