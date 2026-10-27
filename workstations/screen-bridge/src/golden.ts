import type { Extractor, FieldValue, Frame } from './ports';
import { createRecognizer, valueMatches } from './recognize';
import type { StationProfile } from './profile';

/** A recorded frame with the values a person confirmed it shows. */
export interface GoldenFrame {
  readonly name: string;
  readonly frame: Frame;
  readonly screen: string | null;
  readonly expected: Readonly<Record<string, FieldValue>>;
}

export interface GoldenFieldReport {
  readonly field: string;
  readonly extractor: string;
  readonly frames: number;
  /** Readings equal to the confirmed value. */
  readonly correct: number;
  /** Readings at or above the field's threshold: the ones that would become facts. */
  readonly confident: number;
  /** Confident and wrong: the number that must stay zero before a profile or model ships. */
  readonly wrongButConfident: number;
  readonly missing: number;
  readonly meanConfidence: number;
}
export interface GoldenReport {
  readonly profile: { readonly id: string; readonly version: string };
  readonly extractors: readonly { readonly id: string; readonly model?: Extractor['model'] }[];
  readonly screens: { readonly frames: number; readonly correct: number };
  readonly fields: readonly GoldenFieldReport[];
  /** No wrong-but-confident readings and every screen identified correctly. */
  readonly pass: boolean;
}

/**
 * Runs a profile's recognizer over labeled frames. Accuracy alone is not the gate: a model that
 * is often unsure only creates attention items, but one confident misread becomes a false fact.
 * Run it for every profile, extractor and model version change (the vendor-update safety net).
 */
export async function runGolden(
  profile: StationProfile,
  extractors: readonly Extractor[],
  frames: readonly GoldenFrame[],
  signal: AbortSignal = new AbortController().signal,
): Promise<GoldenReport> {
  const recognizer = createRecognizer(profile, extractors);
  const stats = new Map<
    string,
    {
      frames: number;
      correct: number;
      confident: number;
      wrong: number;
      missing: number;
      confidence: number;
    }
  >();
  let screensCorrect = 0;
  for (const golden of frames) {
    const view = await recognizer.view(golden.frame, signal);
    if ((view.screen ?? null) === golden.screen) screensCorrect++;
    for (const [fieldId, expected] of Object.entries(golden.expected)) {
      const field = recognizer.field(fieldId);
      if (!field) throw new Error(`Golden frame ${golden.name} names unknown field ${fieldId}`);
      const entry = stats.get(fieldId) ?? {
        frames: 0,
        correct: 0,
        confident: 0,
        wrong: 0,
        missing: 0,
        confidence: 0,
      };
      stats.set(fieldId, entry);
      entry.frames++;
      const reading = view.readings.get(fieldId);
      if (!reading || reading.value === null) {
        entry.missing++;
        continue;
      }
      const right = expected === null ? false : valueMatches(field, reading.value, expected);
      const confident = reading.confidence >= field.minConfidence;
      entry.confidence += reading.confidence;
      if (right) entry.correct++;
      if (confident) entry.confident++;
      if (confident && !right) entry.wrong++;
    }
  }
  const fields = [...stats].map(([fieldId, entry]) => ({
    field: fieldId,
    extractor: recognizer.field(fieldId)!.extractor,
    frames: entry.frames,
    correct: entry.correct,
    confident: entry.confident,
    wrongButConfident: entry.wrong,
    missing: entry.missing,
    meanConfidence:
      entry.frames - entry.missing ? entry.confidence / (entry.frames - entry.missing) : 0,
  }));
  return {
    profile: { id: profile.id, version: profile.version },
    extractors: extractors.map((extractor) => ({
      id: extractor.id,
      ...(extractor.model ? { model: extractor.model } : {}),
    })),
    screens: { frames: frames.length, correct: screensCorrect },
    fields,
    pass:
      screensCorrect === frames.length && fields.every((field) => field.wrongButConfident === 0),
  };
}
