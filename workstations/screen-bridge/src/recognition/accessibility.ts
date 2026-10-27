import type { Extractor, ExtractionField, FieldValue } from '../ports';
import { findNode } from '../profile';

/** Parse displayed text into a field value; null when it does not fit the field. */
export function parseDisplayed(field: ExtractionField, text: string | undefined): FieldValue {
  if (text === undefined) return null;
  const trimmed = text.trim();
  switch (field.type) {
    case 'number': {
      // Displays group thousands with spaces, apostrophes or narrow spaces and may use a comma.
      const normalized = trimmed
        .replace(field.unit ?? '\u0000', '')
        .replace(/[\s' ]/g, '')
        .replace(',', '.');
      const value = Number(normalized);
      return normalized !== '' && Number.isFinite(value) ? value : null;
    }
    case 'boolean':
      return /^(on|yes|true|1|ein|ja)$/i.test(trimmed)
        ? true
        : /^(off|no|false|0|aus|nein)$/i.test(trimmed)
          ? false
          : null;
    case 'enum':
      return (
        field.options?.find((option) => option.toLowerCase() === trimmed.toLowerCase()) ?? null
      );
    default:
      return trimmed;
  }
}

/**
 * Reads fields from the accessibility tree (browser ARIA, UI Automation, AT-SPI). The most
 * deterministic source after an export or database: confidence 1 when the node exists and its
 * text parses, 0 otherwise. Fields without a locator are left to pixel extractors.
 */
export function createAccessibilityExtractor(id = 'accessibility'): Extractor {
  return {
    id,
    modality: 'accessibility',
    async extract(frame, fields) {
      return fields.flatMap((field) => {
        if (!field.locator) return [];
        const node = findNode(frame.accessibility, field.locator);
        // A present node without text shows an empty value (no alarm), not an unreadable one.
        const value = parseDisplayed(field, node ? (node.text ?? '') : undefined);
        return [{ field: field.id, value, confidence: value === null ? 0 : 1 }];
      });
    },
  };
}
