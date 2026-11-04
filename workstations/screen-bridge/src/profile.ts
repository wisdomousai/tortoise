import { z } from 'zod';
import { validateProfile } from './profile/validate';

/**
 * A station profile is everything specific to one plant about one kind of station software, as versioned
 * data: how to recognize its screens, where each value is shown and how to read it, which parts
 * of the screen must never be touched, and the declared procedures the bridge may run. A vendor
 * update or a new station type is a new profile version gated by golden frames, not new code.
 */
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9.-]*$/);
const region = z.strictObject({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});
const locator = z.strictObject({
  role: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});
/** A literal, or `$input.<path>` taken from the effect payload. */
const binding = z.union([z.string().max(500), z.number(), z.boolean()]);
const target = z.union([
  z.strictObject({ locator }),
  z.strictObject({ region }),
  /** Natural-language target for a computer-use driver; the scripted driver cannot resolve it. */
  z.strictObject({ describe: z.string().min(1).max(500) }),
]);
/** Keys a procedure may press. Anything else (shortcuts, function keys) is added deliberately. */
export const allowedKeys = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
] as const;

const step = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('expect-screen'), screen: id }),
  z.strictObject({ kind: z.literal('click'), target }),
  z.strictObject({ kind: z.literal('type'), text: binding }),
  z.strictObject({ kind: z.literal('key'), key: z.enum(allowedKeys) }),
  z.strictObject({
    kind: z.literal('wait-for'),
    screen: id.optional(),
    field: id.optional(),
    equals: binding.optional(),
    timeoutMs: z.number().int().min(50).max(120_000),
  }),
]);
const condition = z.strictObject({
  field: id,
  equals: binding.optional(),
  in: z.array(binding).min(1).optional(),
});

export const stationProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  /** Profile revision; recorded with every observation and outcome. */
  version: z.string().min(1).max(32),
  application: z.strictObject({
    name: z.string().min(1).max(100),
    vendor: z.string().max(100).optional(),
    /** Station software versions this profile was validated against. */
    versions: z.array(z.string().max(32)).optional(),
  }),
  screens: z
    .array(
      z.strictObject({
        id,
        title: z.string().max(100).optional(),
        /** All anchors must be present in the accessibility tree. */
        anchors: z.array(locator).optional(),
        /** Label a classifier extractor reports as the `$screen` field. */
        label: z.string().max(100).optional(),
      }),
    )
    .min(1),
  fields: z.array(
    z.strictObject({
      id,
      screen: id,
      type: z.enum(['number', 'text', 'enum', 'boolean']),
      locator: locator.optional(),
      region: region.optional(),
      extractor: z.string().min(1).max(64),
      unit: z.string().max(16).optional(),
      decimals: z.number().int().min(0).max(6).optional(),
      options: z.array(z.string().max(100)).optional(),
      hint: z.string().max(300).optional(),
      /** Below this a stable reading becomes an attention item, never a fact. */
      minConfidence: z.number().min(0).max(1).default(0.9),
      /** Consecutive agreeing reads before a value counts as observed. */
      stableReads: z.number().int().min(1).max(10).default(2),
    }),
  ),
  /** Screen parts the bridge must never act on: e-stop reset, interlock override, jog, manual. */
  forbidden: z.array(
    z.strictObject({
      id,
      reason: z.string().min(1).max(200),
      region: region.optional(),
      locator: locator.optional(),
    }),
  ),
  procedures: z.array(
    z.strictObject({
      /** The effect type that runs this procedure, e.g. `recipe.load`. */
      id: z.string().min(1).max(128),
      title: z.string().max(100),
      /**
       * `none`: no machine motion. `low`: changes settings, no motion. `operator-present`: the
       * effect payload must carry a station-side confirmation (`presence.confirmedBy`).
       */
      risk: z.enum(['none', 'low', 'operator-present']),
      /** Safe to run again after an interruption; otherwise an interruption holds the effect. */
      rerunnable: z.boolean(),
      timeoutMs: z.number().int().min(1_000).max(600_000),
      maxSteps: z.number().int().min(1).max(100),
      /** The screen the procedure starts from; lookup treats any other screen as uncertain. */
      startScreen: id,
      preconditions: z.array(condition),
      steps: z.array(step).min(1),
      /** Acceptance: observed values that prove the procedure took effect. */
      readback: z.array(condition).min(1),
    }),
  ),
});
export type StationProfile = z.output<typeof stationProfileSchema>;
export type ProfileField = StationProfile['fields'][number];
export type Procedure = StationProfile['procedures'][number];
export type ProcedureStep = Procedure['steps'][number];
export type Condition = Procedure['readback'][number];

export { resolveBinding } from './profile/bindings';
export { center, contains, findNode, intersects } from './profile/geometry';
export { validateProfile } from './profile/validate';

/** Parse and validate a profile document; throws with every issue listed. */
export function parseProfile(document: unknown): StationProfile {
  const profile = stationProfileSchema.parse(document);
  const { ok, issues } = validateProfile(profile);
  if (!ok) throw new Error(`Invalid station profile ${profile.id}:\n- ${issues.join('\n- ')}`);
  return profile;
}
