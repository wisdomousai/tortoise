import type { Condition, Procedure, ProcedureStep, StationProfile } from '../profile';
import { inputBinding } from './bindings';
import { intersects } from './geometry';

/** What every profile check reads, and the issues it reports into. */
interface ProfileCheck {
  readonly profile: StationProfile;
  readonly screens: ReadonlySet<string>;
  readonly fields: ReadonlySet<string>;
  readonly issues: string[];
}

function duplicates(check: ProfileCheck, kind: string, ids: readonly string[]) {
  const seen = new Set<string>();
  for (const value of ids) {
    if (seen.has(value)) check.issues.push(`Duplicate ${kind} ${value}`);
    seen.add(value);
  }
}

/** Screens, fields and forbidden zones: unique ids, and enough to find each on screen. */
function checkDeclarations(check: ProfileCheck) {
  const { profile, screens, issues } = check;
  duplicates(
    check,
    'screen',
    profile.screens.map((screen) => screen.id),
  );
  duplicates(
    check,
    'field',
    profile.fields.map((field) => field.id),
  );
  duplicates(
    check,
    'forbidden region',
    profile.forbidden.map((zone) => zone.id),
  );
  duplicates(
    check,
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
}

function checkBinding(
  check: ProfileCheck,
  where: string,
  value: string | number | boolean | undefined,
) {
  if (typeof value === 'string' && value.startsWith('$input') && !inputBinding.test(value))
    check.issues.push(`${where}: malformed binding ${value}`);
}

function checkCondition(check: ProfileCheck, where: string, condition: Condition) {
  if (!check.fields.has(condition.field))
    check.issues.push(`${where}: unknown field ${condition.field}`);
  if (condition.equals === undefined && condition.in === undefined)
    check.issues.push(`${where}: condition on ${condition.field} needs equals or in`);
  checkBinding(check, where, condition.equals);
  for (const value of condition.in ?? []) checkBinding(check, where, value);
}

/** A click whose locator or region is, or overlaps, a forbidden zone. */
function checkClick(
  check: ProfileCheck,
  at: string,
  item: Extract<ProcedureStep, { kind: 'click' }>,
) {
  for (const zone of check.profile.forbidden) {
    const hitsLocator =
      'locator' in item.target &&
      zone.locator &&
      zone.locator.role === item.target.locator.role &&
      zone.locator.name === item.target.locator.name;
    const hitsRegion =
      'region' in item.target && zone.region && intersects(zone.region, item.target.region);
    if (hitsLocator || hitsRegion)
      check.issues.push(`${at}: targets forbidden ${zone.id} (${zone.reason})`);
  }
}

function checkStep(check: ProfileCheck, at: string, item: ProcedureStep) {
  const { screens, fields, issues } = check;
  if (item.kind === 'expect-screen' && !screens.has(item.screen))
    issues.push(`${at}: unknown screen ${item.screen}`);
  if (item.kind === 'wait-for') {
    if (!item.screen && !item.field) issues.push(`${at}: wait-for needs a screen or field`);
    if (item.screen && !screens.has(item.screen))
      issues.push(`${at}: unknown screen ${item.screen}`);
    if (item.field && !fields.has(item.field)) issues.push(`${at}: unknown field ${item.field}`);
    checkBinding(check, at, item.equals);
  }
  if (item.kind === 'type') checkBinding(check, at, item.text);
  if (item.kind === 'click') checkClick(check, at, item);
}

function checkProcedure(check: ProfileCheck, procedure: Procedure) {
  const where = `Procedure ${procedure.id}`;
  if (!check.screens.has(procedure.startScreen))
    check.issues.push(`${where}: unknown start screen ${procedure.startScreen}`);
  procedure.preconditions.forEach((condition) =>
    checkCondition(check, `${where} precondition`, condition),
  );
  procedure.readback.forEach((condition) => checkCondition(check, `${where} readback`, condition));
  const actions = procedure.steps.filter(
    (item) => item.kind !== 'expect-screen' && item.kind !== 'wait-for',
  );
  if (actions.length > procedure.maxSteps)
    check.issues.push(`${where}: ${actions.length} actions exceed maxSteps ${procedure.maxSteps}`);
  procedure.steps.forEach((item, index) => checkStep(check, `${where} step ${index + 1}`, item));
}

/**
 * Check a profile beyond its schema. Rejects references to unknown screens or fields, malformed
 * `$input` bindings, procedures without readback, and every click whose target is or overlaps a
 * forbidden region; the controller enforces the same rule again at run time on resolved points.
 */
export function validateProfile(profile: StationProfile): { ok: boolean; issues: string[] } {
  const check: ProfileCheck = {
    profile,
    screens: new Set(profile.screens.map((screen) => screen.id)),
    fields: new Set(profile.fields.map((field) => field.id)),
    issues: [],
  };
  checkDeclarations(check);
  for (const procedure of profile.procedures) checkProcedure(check, procedure);
  return { ok: check.issues.length === 0, issues: check.issues };
}
