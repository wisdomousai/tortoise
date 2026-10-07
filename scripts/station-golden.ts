/**
 * Gate a station profile and its perception models on labeled golden frames.
 *
 *   bun scripts/station-golden.ts examples/line-station/golden
 *
 * Accessibility fields are read from each frame's recorded tree. Pixel fields use, in order:
 * - STATION_VISION_BASE_URL + STATION_VISION_MODEL: a local OpenAI-compatible vision model
 *   (loopback, or hosts listed in STATION_VISION_ALLOWED_HOSTS), STATION_VISION_READS reads each;
 * - STATION_PERCEPTION_WORKER: a JSON array command for a JSON-lines perception worker;
 * - otherwise the manifest's expected values replayed as a fixture, which checks wiring only.
 * Nothing is discovered: without explicit configuration no model is called. Exits non-zero when
 * a screen is misidentified or any reading is confident and wrong.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createAccessibilityExtractor,
  createFixtureExtractor,
  createOpenAiCompatibleVisionExtractor,
  createWorkerExtractor,
  parseProfile,
  runGolden,
  type Extractor,
  type FieldValue,
  type Frame,
  type GoldenFrame,
} from '@agent-native/station';

interface Manifest {
  readonly profile: string;
  readonly frames: readonly {
    readonly name: string;
    readonly frame: string;
    readonly image?: string;
    readonly screen: string | null;
    readonly expected: Record<string, FieldValue>;
  }[];
}

const directory = resolve(process.argv[2] ?? 'examples/line-station/golden');
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as Manifest;
const profile = parseProfile(
  JSON.parse(readFileSync(resolve(directory, manifest.profile), 'utf8')),
);
const { STATION_VISION_BASE_URL, STATION_VISION_MODEL, STATION_PERCEPTION_WORKER } = process.env;
const pixelModel = Boolean(
  (STATION_VISION_BASE_URL && STATION_VISION_MODEL) || STATION_PERCEPTION_WORKER,
);
// Source exports carry text files only, so recorded PNGs can be absent. The wiring check needs
// only the recorded tree and digest; a pixel model needs the pixels, so it fails instead.
const missingImages: string[] = [];
const frames: GoldenFrame[] = manifest.frames.map((entry) => {
  const frame = JSON.parse(readFileSync(resolve(directory, entry.frame), 'utf8')) as Frame;
  const image = entry.image ? resolve(directory, entry.image) : undefined;
  if (image && !existsSync(image)) missingImages.push(entry.image!);
  return {
    name: entry.name,
    screen: entry.screen,
    expected: entry.expected,
    frame:
      image && existsSync(image) ? { ...frame, image: new Uint8Array(readFileSync(image)) } : frame,
  };
});
if (missingImages.length && pixelModel) {
  console.error(
    `Golden images missing (${missingImages.join(', ')}); record them with bun run station:record-golden`,
  );
  process.exit(2);
}

const pixelExtractors = [...new Set(profile.fields.map((field) => field.extractor))].filter(
  (id) => id !== 'accessibility',
);
const closers: (() => Promise<void>)[] = [];
let source = 'recorded expectations (wiring check, no model)';
function pixelExtractor(id: string): Extractor {
  const [baseUrl, model, worker] = [
    STATION_VISION_BASE_URL,
    STATION_VISION_MODEL,
    STATION_PERCEPTION_WORKER,
  ];
  if (baseUrl && model) {
    source = `vision model ${model}`;
    return createOpenAiCompatibleVisionExtractor({
      id,
      baseUrl,
      model,
      allowedHosts: (process.env.STATION_VISION_ALLOWED_HOSTS ?? '').split(',').filter(Boolean),
      reads: Number(process.env.STATION_VISION_READS ?? 3),
    });
  }
  if (worker) {
    const command = JSON.parse(worker) as [string, ...string[]];
    source = `perception worker ${command[0]}`;
    const extractor = createWorkerExtractor({ id, modality: 'ocr', command });
    closers.push(() => extractor.close());
    return extractor;
  }
  const fields = new Set(
    profile.fields.filter((field) => field.extractor === id).map((field) => field.id),
  );
  return createFixtureExtractor(
    Object.fromEntries(
      frames.map((golden) => [
        golden.frame.digest,
        Object.fromEntries(
          Object.entries(golden.expected)
            .filter(([field]) => fields.has(field))
            .map(([field, value]) => [field, { value, confidence: 1 }]),
        ),
      ]),
    ),
    { id, modality: 'fixture' },
  );
}

try {
  const report = await runGolden(
    profile,
    [createAccessibilityExtractor(), ...pixelExtractors.map(pixelExtractor)],
    frames,
  );
  console.log(
    `Profile ${report.profile.id}@${report.profile.version}; pixel fields from ${source}`,
  );
  console.log(`Screens identified: ${report.screens.correct}/${report.screens.frames}`);
  console.table(
    report.fields.map((field) => ({
      field: field.field,
      extractor: field.extractor,
      frames: field.frames,
      correct: field.correct,
      confident: field.confident,
      'wrong but confident': field.wrongButConfident,
      missing: field.missing,
      'mean confidence': Number(field.meanConfidence.toFixed(3)),
    })),
  );
  console.log(report.pass ? 'PASS' : 'FAIL: confident misreads or misidentified screens');
  process.exitCode = report.pass ? 0 : 1;
} finally {
  await Promise.all(closers.map((close) => close()));
}
