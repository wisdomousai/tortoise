import type { FieldValue, Reading } from './readings';

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

/** What the gate needs to know about one field: its stability and confidence standard. */
export interface GatedField<Declared> {
  readonly stableReads: number;
  readonly minConfidence: number;
  /** The source's declaration of the field, carried with the reading (type, options, unit). */
  readonly declared: Declared;
}

/**
 * A reading that passed the stability gate: `observed` when confident enough to become fact,
 * `uncertain` when stable but below the field's threshold (the domain asks a person instead).
 */
export type ObservedReading<Declared> = Reading & {
  readonly status: 'observed' | 'uncertain';
  readonly minConfidence: number;
  readonly declared: Declared;
};

/**
 * Readings that passed the stability gate, each marked observed or uncertain. Fields missing from
 * `readings` are forgotten, so they restart their count when they reappear. A reading for a field
 * `fieldOf` does not know is dropped.
 */
export function gateReadings<Declared>(
  gate: StabilityGate,
  readings: Iterable<Reading>,
  fieldOf: (id: string) => GatedField<Declared> | undefined,
): ObservedReading<Declared>[] {
  const all = [...readings];
  gate.retain(new Set(all.map((reading) => reading.field)));
  const gated: ObservedReading<Declared>[] = [];
  for (const reading of all) {
    const field = fieldOf(reading.field);
    if (!field || !gate.push(reading.field, reading.value, field.stableReads)) continue;
    gated.push({
      ...reading,
      status:
        reading.value !== null && reading.confidence >= field.minConfidence
          ? 'observed'
          : 'uncertain',
      minConfidence: field.minConfidence,
      declared: field.declared,
    });
  }
  return gated;
}
