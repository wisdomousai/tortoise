import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
  type AgentDefinition,
} from '../src/index';

const operation = (
  id: string,
  kind: 'command' | 'query',
  ui: { binding?: string; exception?: string },
) =>
  defineCapability({
    id,
    kind,
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({})),
    permission: { action: kind === 'command' ? 'write' : 'read', resourceType: 'Lot' },
    ui,
  });

const capabilities = [
  operation('lot.list', 'query', { binding: 'lot.list' }),
  operation('lot.release', 'command', { binding: 'lot.release' }),
  operation('lot.recompute', 'command', { exception: 'job only' }),
];

const agent = (overrides: Partial<AgentDefinition> = {}) =>
  defineAgent({
    id: 'lot.reviewer',
    title: 'Lot reviewer',
    instructions: 'Review lots waiting for release and release the ones that pass.',
    operations: ['lot.list', 'lot.release'],
    resourceTypes: ['lot'],
    model: 'any',
    output: 'direct',
    budgets: { turns: 8, toolCalls: 20, wallTimeMs: 60_000 },
    ...overrides,
  });

const catalogWith = (...agents: AgentDefinition[]) =>
  buildCatalog([defineModule({ id: 'lots', capabilities, agents })]);

test('agents enter the catalog with their module, sorted by ID', () => {
  const catalog = catalogWith(agent({ id: 'lot.z' }), agent({ id: 'lot.a' }));
  expect(catalog.agents.map((entry) => [entry.id, entry.module])).toEqual([
    ['lot.a', 'lots'],
    ['lot.z', 'lots'],
  ]);
  expect(catalogWith().agents).toEqual([]);
});

test('an agent naming an unknown operation fails the catalog', () => {
  expect(() => catalogWith(agent({ operations: ['lot.list', 'lot.delete'] }))).toThrow(
    'Agent lot.reviewer references unknown operation lot.delete',
  );
});

test('a direct agent may only run commands that have a UI binding; a proposing one may name any', () => {
  expect(() => catalogWith(agent({ operations: ['lot.recompute'] }))).toThrow(
    'Direct agent lot.reviewer runs lot.recompute, which has no UI binding',
  );
  expect(
    catalogWith(agent({ operations: ['lot.recompute'], output: 'propose' })).agents,
  ).toHaveLength(1);
});

test('duplicate IDs, empty or repeated operations, unbounded budgets and bad scopes fail', () => {
  expect(() => catalogWith(agent(), agent())).toThrow('Duplicate agent: lot.reviewer');
  expect(() => catalogWith(agent({ operations: [] }))).toThrow('has no operations');
  expect(() => catalogWith(agent({ operations: ['lot.list', 'lot.list'] }))).toThrow('twice');
  expect(() => catalogWith(agent({ budgets: { turns: 0, toolCalls: 1, wallTimeMs: 1 } }))).toThrow(
    'budget turns must be an integer',
  );
  expect(() =>
    catalogWith(agent({ budgets: { turns: 1, toolCalls: 1, wallTimeMs: Infinity } })),
  ).toThrow('budget wallTimeMs');
  expect(() => catalogWith(agent({ resourceTypes: ['lot:'] }))).toThrow('not a resource type');
  expect(() => catalogWith(agent({ id: 'Lot Reviewer' }))).toThrow('Invalid agent ID');
  expect(() => catalogWith(agent({ instructions: ' ' }))).toThrow('needs a title and instructions');
});

test('defineAgent freezes the definition and its operations', () => {
  const defined = agent();
  expect(Object.isFrozen(defined)).toBe(true);
  expect(Object.isFrozen(defined.operations)).toBe(true);
});
