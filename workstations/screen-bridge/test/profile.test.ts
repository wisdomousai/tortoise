import { expect, test } from 'bun:test';
import {
  parseProfile,
  resolveBinding,
  stationProfileSchema,
  validateProfile,
} from '../src/profile';
import { profileDocument } from './support';

const clone = () =>
  structuredClone(profileDocument) as typeof profileDocument & Record<string, any>;

test('the reference profile is valid', () => {
  expect(validateProfile(parseProfile(profileDocument))).toEqual({ ok: true, issues: [] });
});

test('procedures may not click into forbidden regions, by region or by locator', () => {
  const document = clone();
  document.procedures[0]!.steps.push({
    kind: 'click',
    target: { region: { x: 790, y: 690, width: 20, height: 20 } },
  } as never);
  document.forbidden.push({
    id: 'jog',
    reason: 'Manual motion',
    locator: { role: 'button', name: 'Load recipe' },
  } as never);
  const result = validateProfile(stationProfileSchema.parse(document));
  expect(result.ok).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.stringContaining('targets forbidden estop-reset'),
      expect.stringContaining('targets forbidden jog'),
    ]),
  );
});

test('unknown references, malformed bindings and missing locators are reported', () => {
  const document = clone();
  document.procedures[0]!.readback = [{ field: 'nope', equals: '$input.recipe-id' }];
  document.fields.push({
    id: 'floating',
    screen: 'ghost',
    type: 'enum',
    extractor: 'accessibility',
  } as never);
  expect(() => parseProfile(document)).toThrow('Invalid station profile line-hmi');
  expect(validateProfile(stationProfileSchema.parse(document)).issues).toEqual([
    'Field floating is on unknown screen ghost',
    'Field floating needs a locator or region',
    'Enum field floating needs options',
    'Procedure recipe.load readback: unknown field nope',
    'Procedure recipe.load readback: malformed binding $input.recipe-id',
  ]);
});

test('free-form keys are not allowed in procedures', () => {
  const document = clone();
  document.procedures[0]!.steps.push({ kind: 'key', key: 'F12' } as never);
  expect(stationProfileSchema.safeParse(document).success).toBe(false);
});

test('bindings resolve own payload paths only', () => {
  const input = { recipe: 'R-12', presence: { confirmedBy: 'op-7' } };
  expect(resolveBinding('$input.presence.confirmedBy', input)).toBe('op-7');
  expect(resolveBinding('$input.constructor', input)).toBeUndefined();
  expect(resolveBinding('$input.missing.deep', input)).toBeUndefined();
  expect(resolveBinding('literal', input)).toBe('literal');
});
