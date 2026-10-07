import { z } from 'zod';
import type { AccessibilityNode, Point, Region } from './ports';

/**
 * A station profile is everything site-specific about one kind of station software, as versioned
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
      hazard: z.enum(['none', 'low', 'operator-present']),
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

const inputBinding = /^\$input\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)$/;

/** Resolve a literal or `$input.<path>` against an effect payload; undefined when absent. */
export function resolveBinding(value: string | number | boolean, input: unknown): unknown {
  if (typeof value !== 'string') return value;
  const match = inputBinding.exec(value);
  if (!match) return value.startsWith('$input') ? undefined : value;
  let current: unknown = input;
  for (const key of match[1]!.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function intersects(a: Region, b: Region): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
export function contains(region: Region, point: Point): boolean {
  return (
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  );
}
export const center = (region: Region): Point => ({
  x: region.x + region.width / 2,
  y: region.y + region.height / 2,
});

/** Depth-first search for a node by role and accessible name. */
export function findNode(
  nodes: readonly AccessibilityNode[] | undefined,
  wanted: { readonly role: string; readonly name: string },
): AccessibilityNode | undefined {
  for (const node of nodes ?? []) {
    if (node.role === wanted.role && node.name === wanted.name) return node;
    const found = findNode(node.children, wanted);
    if (found) return found;
  }
  return undefined;
}

/**
 * Check a profile beyond its schema. Rejects references to unknown screens or fields, malformed
 * `$input` bindings, procedures without readback, and every click whose target is or overlaps a
 * forbidden region; the controller enforces the same rule again at run time on resolved points.
 */
export function validateProfile(profile: StationProfile): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const screens = new Set(profile.screens.map((screen) => screen.id));
  const fields = new Set(profile.fields.map((field) => field.id));
  const duplicates = (kind: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const value of ids) {
      if (seen.has(value)) issues.push(`Duplicate ${kind} ${value}`);
      seen.add(value);
    }
  };
  duplicates(
    'screen',
    profile.screens.map((screen) => screen.id),
  );
  duplicates(
    'field',
    profile.fields.map((field) => field.id),
  );
  duplicates(
    'forbidden region',
    profile.forbidden.map((zone) => zone.id),
  );
  duplicates(
    'procedure',
    profile.procedures.map((procedure) => procedure.id),
  );
  for (const screen of profile.screens)
    if (!screen.anchors?.length && !screen.label)
      issues.push(`Screen ${screen.id} needs anchors or a classifier label`);
  for (const field of profile.fields) {
    if (!screens.has(field.screen))
      issues.push(`Field ${field.id} is on unknown screen ${field.screen}`);
    if (!field.locator && !field.region) issues.push(`Field ${field.id} needs a locator or region`);
    if (field.type === 'enum' && !field.options?.length)
      issues.push(`Enum field ${field.id} needs options`);
  }
  for (const zone of profile.forbidden)
    if (!zone.region && !zone.locator)
      issues.push(`Forbidden ${zone.id} needs a region or locator`);

  const checkBinding = (where: string, value: string | number | boolean | undefined) => {
    if (typeof value === 'string' && value.startsWith('$input') && !inputBinding.test(value))
      issues.push(`${where}: malformed binding ${value}`);
  };
  const checkCondition = (where: string, condition: Condition) => {
    if (!fields.has(condition.field)) issues.push(`${where}: unknown field ${condition.field}`);
    if (condition.equals === undefined && condition.in === undefined)
      issues.push(`${where}: condition on ${condition.field} needs equals or in`);
    checkBinding(where, condition.equals);
    for (const value of condition.in ?? []) checkBinding(where, value);
  };
  for (const procedure of profile.procedures) {
    const where = `Procedure ${procedure.id}`;
    if (!screens.has(procedure.startScreen))
      issues.push(`${where}: unknown start screen ${procedure.startScreen}`);
    procedure.preconditions.forEach((condition) =>
      checkCondition(`${where} precondition`, condition),
    );
    procedure.readback.forEach((condition) => checkCondition(`${where} readback`, condition));
    const actions = procedure.steps.filter(
      (item) => item.kind !== 'expect-screen' && item.kind !== 'wait-for',
    );
    if (actions.length > procedure.maxSteps)
      issues.push(`${where}: ${actions.length} actions exceed maxSteps ${procedure.maxSteps}`);
    procedure.steps.forEach((item, index) => {
      const at = `${where} step ${index + 1}`;
      if (item.kind === 'expect-screen' && !screens.has(item.screen))
        issues.push(`${at}: unknown screen ${item.screen}`);
      if (item.kind === 'wait-for') {
        if (!item.screen && !item.field) issues.push(`${at}: wait-for needs a screen or field`);
        if (item.screen && !screens.has(item.screen))
          issues.push(`${at}: unknown screen ${item.screen}`);
        if (item.field && !fields.has(item.field))
          issues.push(`${at}: unknown field ${item.field}`);
        checkBinding(at, item.equals);
      }
      if (item.kind === 'type') checkBinding(at, item.text);
      if (item.kind !== 'click') return;
      for (const zone of profile.forbidden) {
        const hitsLocator =
          'locator' in item.target &&
          zone.locator &&
          zone.locator.role === item.target.locator.role &&
          zone.locator.name === item.target.locator.name;
        const hitsRegion =
          'region' in item.target && zone.region && intersects(zone.region, item.target.region);
        if (hitsLocator || hitsRegion)
          issues.push(`${at}: targets forbidden ${zone.id} (${zone.reason})`);
      }
    });
  }
  return { ok: issues.length === 0, issues };
}

/** Parse and validate a profile document; throws with every issue listed. */
export function parseProfile(document: unknown): StationProfile {
  const profile = stationProfileSchema.parse(document);
  const { ok, issues } = validateProfile(profile);
  if (!ok) throw new Error(`Invalid station profile ${profile.id}:\n- ${issues.join('\n- ')}`);
  return profile;
}
