import type { Extractor, ExtractionField, FieldValue, Frame, ModelIdentity } from './ports';
import {
  findNode,
  type Condition,
  type ProfileField,
  type StationProfile,
  resolveBinding,
} from './profile';

/** A field value with the provenance every consumer needs to judge it. */
export interface Reading {
  readonly field: string;
  readonly value: FieldValue;
  readonly confidence: number;
  readonly extractor: string;
  readonly model?: ModelIdentity;
  readonly observedAt: number;
  readonly frameDigest: string;
}
export interface View {
  readonly frame: Frame;
  /** Identified screen, or undefined when no screen of the profile matches (popup, vendor dialog). */
  readonly screen?: string;
  readonly readings: ReadonlyMap<string, Reading>;
}

const toExtractionField = (field: ProfileField): ExtractionField => ({
  id: field.id,
  type: field.type,
  ...(field.region ? { region: field.region } : {}),
  ...(field.locator ? { locator: field.locator } : {}),
  ...(field.unit ? { unit: field.unit } : {}),
  ...(field.decimals !== undefined ? { decimals: field.decimals } : {}),
  ...(field.options ? { options: field.options } : {}),
  ...(field.hint ? { hint: field.hint } : {}),
});

/**
 * Reads a station screen through a profile: identifies the screen, then asks each field's
 * extractor for the fields shown on it. Extractors are resolved once, so a profile naming an
 * unknown extractor fails at construction, not on the floor.
 */
export function createPerception(profile: StationProfile, extractors: readonly Extractor[]) {
  const byId = new Map(extractors.map((extractor) => [extractor.id, extractor]));
  for (const field of profile.fields)
    if (!byId.has(field.extractor))
      throw new Error(`Profile ${profile.id} field ${field.id} needs extractor ${field.extractor}`);
  const classifiers = extractors.filter((extractor) => extractor.modality === 'classifier');

  async function identify(frame: Frame, signal: AbortSignal): Promise<string | undefined> {
    // Deterministic anchors first; a classifier only when no anchored screen matches.
    for (const screen of profile.screens)
      if (
        screen.anchors?.length &&
        screen.anchors.every((anchor) => findNode(frame.accessibility, anchor))
      )
        return screen.id;
    for (const classifier of classifiers) {
      const [label] = await classifier.extract(frame, [{ id: '$screen', type: 'text' }], signal);
      const screen = profile.screens.find(
        (candidate) => candidate.label && candidate.label === label?.value,
      );
      if (screen) return screen.id;
    }
    return undefined;
  }

  async function view(frame: Frame, signal: AbortSignal): Promise<View> {
    const screen = await identify(frame, signal);
    const readings = new Map<string, Reading>();
    if (!screen) return { frame, readings };
    const fields = profile.fields.filter((field) => field.screen === screen);
    const groups = new Map<string, ProfileField[]>();
    for (const field of fields)
      groups.set(field.extractor, [...(groups.get(field.extractor) ?? []), field]);
    for (const [extractorId, group] of groups) {
      const extractor = byId.get(extractorId)!;
      const wanted = new Set(group.map((field) => field.id));
      for (const raw of await extractor.extract(frame, group.map(toExtractionField), signal)) {
        // An extractor may only answer for fields it was asked about.
        if (!wanted.has(raw.field)) continue;
        readings.set(raw.field, {
          field: raw.field,
          value: raw.value,
          confidence: Math.min(1, Math.max(0, raw.confidence)),
          extractor: extractor.id,
          ...(extractor.model ? { model: extractor.model } : {}),
          observedAt: frame.capturedAt,
          frameDigest: frame.digest,
        });
      }
    }
    return { frame, screen, readings };
  }
  return { identify, view, field: (id: string) => profile.fields.find((field) => field.id === id) };
}
export type Perception = ReturnType<typeof createPerception>;

/** Compare an observed value with an expected one; numbers within half a displayed digit. */
export function valueMatches(
  field: ProfileField | undefined,
  observed: FieldValue,
  expected: unknown,
) {
  if (observed === null || expected === undefined || expected === null) return false;
  if (typeof observed === 'number' || field?.type === 'number') {
    const a = Number(observed);
    const b = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= 0.5 * 10 ** -(field?.decimals ?? 6);
  }
  return String(observed).trim() === String(expected).trim();
}

/**
 * Evaluate conditions against a view. A condition only counts as met with a reading at or above
 * the field's confidence threshold; an unsure reading is `unknown`, never `met`.
 */
export function evaluate(
  perception: Perception,
  view: View,
  conditions: readonly Condition[],
  input: unknown,
): { readonly met: boolean; readonly unmet: string[]; readonly unknown: string[] } {
  const unmet: string[] = [];
  const unknown: string[] = [];
  for (const condition of conditions) {
    const field = perception.field(condition.field);
    const reading = view.readings.get(condition.field);
    if (!reading || reading.confidence < (field?.minConfidence ?? 1)) {
      unknown.push(condition.field);
      continue;
    }
    const expected =
      condition.equals !== undefined
        ? [resolveBinding(condition.equals, input)]
        : (condition.in ?? []).map((value) => resolveBinding(value, input));
    if (!expected.some((value) => valueMatches(field, reading.value, value)))
      unmet.push(`${condition.field} is ${String(reading.value)}`);
  }
  return { met: unmet.length === 0 && unknown.length === 0, unmet, unknown };
}

/**
 * Counts agreeing consecutive reads per field. A value is stable once `required` reads in a row
 * agree; a different value restarts the count. Pure, so observer behavior is testable.
 */
export class StabilityGate {
  private readonly runs = new Map<string, { key: string; count: number }>();
  push(field: string, value: FieldValue, required: number): boolean {
    const key = JSON.stringify(value);
    const run = this.runs.get(field);
    const count = run && run.key === key ? run.count + 1 : 1;
    this.runs.set(field, { key, count });
    return count >= required;
  }
  /** Forget fields that are no longer visible, so a screen change restarts their count. */
  retain(visible: ReadonlySet<string>): void {
    for (const field of this.runs.keys()) if (!visible.has(field)) this.runs.delete(field);
  }
}
