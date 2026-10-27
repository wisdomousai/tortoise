/**
 * Test methods by the words a description uses, checked in order. A deterministic stand-in for the
 * oil lab's method catalog, so a job and an offline run need no model. Browser-safe.
 */
const methods: readonly (readonly [RegExp, string])[] = [
  [/\bgas\b/i, 'IEC 60567 dissolved gas analysis'],
  [/\bbreakdown\b/i, 'IEC 60156 breakdown voltage'],
  [/\b(?:furan|paper aging)\b/i, 'IEC 61198 furan analysis'],
  [/\b(?:water|moisture)\b/i, 'IEC 60814 water content'],
];

/** The test method the description asks for, or an empty string when no word matches. */
export function methodFor(description: string): string {
  return methods.find(([words]) => words.test(description))?.[1] ?? '';
}
