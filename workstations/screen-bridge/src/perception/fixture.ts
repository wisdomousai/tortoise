import type { Extractor, FieldValue, ModelIdentity } from '../ports';

/**
 * Replays recorded readings by frame digest: the CI stand-in for OCR and vision models, so
 * pixel-only paths, confidence thresholds and attention items are tested without a model.
 * Unknown frames yield no readings, exactly like a model that sees nothing it recognizes.
 */
export function createFixtureExtractor(
  readings: Readonly<
    Record<string, Readonly<Record<string, { value: FieldValue; confidence: number }>>>
  >,
  options: {
    readonly id?: string;
    readonly modality?: Extractor['modality'];
    readonly model?: ModelIdentity;
  } = {},
): Extractor {
  return {
    id: options.id ?? 'fixture',
    modality: options.modality ?? 'fixture',
    ...(options.model ? { model: options.model } : {}),
    async extract(frame, fields) {
      const recorded = readings[frame.digest] ?? {};
      return fields.flatMap((field) => {
        const reading = recorded[field.id];
        return reading ? [{ field: field.id, ...reading }] : [];
      });
    },
  };
}
