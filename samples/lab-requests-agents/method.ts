/**
 * Test methods by the words a description uses, checked in order. A deterministic stand-in for a
 * lab's method catalog, so a job and an offline run need no model. Browser-safe.
 */
const methods: readonly (readonly [RegExp, string])[] = [
  [/\btensile\b/i, 'ASTM E8 tensile test'],
  [/\bhardness\b/i, 'ASTM E18 Rockwell hardness'],
  [/\bsalt[ -]spray\b/i, 'ASTM B117 salt spray'],
  [/\bmoisture\b/i, 'ASTM D2216 moisture content'],
];

/** The test method the description asks for, or an empty string when no word matches. */
export function methodFor(description: string): string {
  return methods.find(([words]) => words.test(description))?.[1] ?? '';
}
