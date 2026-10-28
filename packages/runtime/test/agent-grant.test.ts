import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import { agentGrant } from '../src/index';
import { grantPermits } from '../src/application/delegation';

const operation = (id: string, kind: 'command' | 'query') =>
  defineCapability({
    id,
    kind,
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({})),
    permission: { action: kind === 'command' ? 'write' : 'read', resourceType: 'Lot' },
    ui: { binding: id },
  });
const budgets = { turns: 4, toolCalls: 10, wallTimeMs: 60_000 };
const catalog = buildCatalog([
  defineModule({
    id: 'lots',
    capabilities: [
      operation('lot.list', 'query'),
      operation('lot.get', 'query'),
      operation('lot.release', 'command'),
      operation('approval.request', 'command'),
    ],
    agents: [
      defineAgent({
        id: 'lot.releaser',
        title: 'Releaser',
        instructions: 'Release passing lots.',
        operations: ['lot.get', 'lot.release'],
        resourceTypes: ['lot'],
        model: 'local',
        output: 'direct',
        budgets,
      }),
      defineAgent({
        id: 'lot.advisor',
        title: 'Advisor',
        instructions: 'Suggest which lots to release.',
        operations: ['lot.list', 'lot.release'],
        model: 'any',
        output: 'request-approval',
        budgets,
      }),
    ],
  }),
]);
const person = { principalId: 'ann', workspaceId: 'plant' };

test('a direct agent gets its operations, bound to the issuer and the run', () => {
  const grant = agentGrant(catalog, 'lot.releaser', person, {
    runId: 'run-1',
    resources: ['lot:7', 'station:2'],
    now: 1_000,
  });
  expect(grant).toEqual({
    operations: ['lot.get', 'lot.release'],
    resources: ['lot:7'],
    expiresAt: 61_000,
    principalId: 'ann',
    workspaceId: 'plant',
    runId: 'run-1',
    agent: 'lot.releaser',
  });
  expect(grantPermits(grant, 2_000, 'lot.release', 'lot:7')).toBe(true);
  expect(grantPermits(grant, 2_000, 'lot.release', 'lot:8')).toBe(false);
  expect(grantPermits(grant, 2_000, 'lot.list')).toBe(false);
  expect(grantPermits(grant, 61_000, 'lot.get', 'lot:7')).toBe(false);
});

test('an agent grant never widens the issuer grant', () => {
  const grant = agentGrant(
    catalog,
    'lot.releaser',
    {
      ...person,
      grant: { operations: ['lot.get', 'lot.list'], resources: ['lot:8'], expiresAt: 5_000 },
    },
    { resources: ['lot:7', 'lot:8'], now: 1_000 },
  );
  expect(grant.operations).toEqual(['lot.get']);
  expect(grant.resources).toEqual(['lot:8']);
  expect(grant.expiresAt).toBe(5_000);
  // Without starting resources a scoped agent reaches none.
  expect(agentGrant(catalog, 'lot.releaser', person, { now: 0 }).resources).toEqual([]);
});

test('a requesting agent runs its queries and records approvals instead of its commands', () => {
  const grant = agentGrant(catalog, 'lot.advisor', person, { now: 0 });
  expect(grant.operations).toEqual(['lot.list', 'approval.request']);
  expect(grant.requests).toEqual(['lot.release']);
  expect(grant.resources).toBeUndefined();
  // Not scoped to resources, so it needs no `creates` to record its approval requests.
  expect(grant.creates).toBeUndefined();
});

test('a scoped run may create records of the types its definition declares', () => {
  const scoped = buildCatalog([
    defineModule({
      id: 'lots',
      capabilities: [
        operation('lot.get', 'query'),
        operation('lot.note', 'command'),
        operation('approval.request', 'command'),
      ],
      agents: [
        defineAgent({
          id: 'lot.noter',
          title: 'Noter',
          instructions: 'Note what you find on a lot.',
          operations: ['lot.get', 'lot.note'],
          resourceTypes: ['lot'],
          creates: ['lot-note'],
          model: 'any',
          output: 'request-approval',
          budgets,
        }),
      ],
    }),
  ]);
  const grant = agentGrant(scoped, 'lot.noter', person, { resources: ['lot:7'], now: 0 });
  expect(grant.creates).toEqual(['lot-note', 'approval-request']);
  expect(grant.agent).toBe('lot.noter');
  // Started on no resources, the run changes no existing record but may still create its own.
  const empty = agentGrant(scoped, 'lot.noter', person, { now: 0 });
  expect(empty.resources).toEqual([]);
  expect(empty.creates).toEqual(['lot-note', 'approval-request']);
});

test('an agent that creates a malformed type is refused', () => {
  expect(() =>
    buildCatalog([
      defineModule({
        id: 'lots',
        capabilities: [operation('lot.get', 'query')],
        agents: [
          defineAgent({
            id: 'lot.bad',
            title: 'Bad',
            instructions: 'Read lots.',
            operations: ['lot.get'],
            creates: ['lot:7'],
            model: 'any',
            output: 'direct',
            budgets,
          }),
        ],
      }),
    ]),
  ).toThrow('is not a resource type name');
});

test('an unknown agent is NOT_FOUND', () => {
  expect(() => agentGrant(catalog, 'lot.missing', person, { now: 0 })).toThrow(
    expect.objectContaining({ code: 'NOT_FOUND' }),
  );
});

test('an agent grant covers what its operations invoke, within the issuer grant', () => {
  const composite = buildCatalog([
    defineModule({
      id: 'lots',
      capabilities: [
        { ...operation('lot.release-all', 'command'), invokes: ['lot.release'] },
        operation('lot.release', 'command'),
        { ...operation('lot.summary', 'query'), invokes: ['lot.list'] },
        operation('lot.list', 'query'),
        operation('approval.request', 'command'),
      ],
      agents: [
        defineAgent({
          id: 'lot.batch',
          title: 'Batch',
          instructions: 'Release every passing lot.',
          operations: ['lot.release-all'],
          model: 'local',
          output: 'direct',
          budgets,
        }),
        defineAgent({
          id: 'lot.reporter',
          title: 'Reporter',
          instructions: 'Summarize the lots.',
          operations: ['lot.summary', 'lot.release-all'],
          model: 'local',
          output: 'request-approval',
          budgets,
        }),
      ],
    }),
  ]);
  expect(agentGrant(composite, 'lot.batch', person, { now: 0 }).operations).toEqual([
    'lot.release-all',
    'lot.release',
  ]);
  expect(
    agentGrant(
      composite,
      'lot.batch',
      { ...person, grant: { operations: ['lot.release-all'] } },
      { now: 0 },
    ).operations,
  ).toEqual(['lot.release-all']);
  expect(agentGrant(composite, 'lot.reporter', person, { now: 0 }).operations).toEqual([
    'lot.summary',
    'lot.list',
    'approval.request',
  ]);
});

test('a direct agent with requests also gets approval.request, never the requested commands', () => {
  const desk = buildCatalog([
    defineModule({
      id: 'lots',
      capabilities: [
        operation('lot.get', 'query'),
        operation('lot.release', 'command'),
        operation('lot.scrap', 'command'),
        operation('approval.request', 'command'),
      ],
      agents: [
        defineAgent({
          id: 'lot.desk',
          title: 'Desk',
          instructions: 'Release lots; ask before scrapping one.',
          operations: ['lot.get', 'lot.release'],
          requests: ['lot.scrap'],
          model: 'any',
          output: 'direct',
          budgets,
        }),
      ],
    }),
  ]);
  expect(agentGrant(desk, 'lot.desk', person, { now: 0 }).operations).toEqual([
    'lot.get',
    'lot.release',
    'approval.request',
  ]);
});
