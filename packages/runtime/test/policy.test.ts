import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  defineMembership,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import {
  createApplication,
  createMemoryStorage,
  definePolicy,
  membershipHandler,
  membershipRule,
  own,
  type AuthorizationRequest,
  type Decision,
  type ExecutionContext,
} from '../src/index';

type Role = 'lead' | 'member';
interface State {
  integration: string;
  teams: Record<string, { members: Record<string, Role> }>;
  notes: Record<string, { team: string }>;
}
const state = (): State => ({
  integration: 'sync-bot',
  teams: { red: { members: { ann: 'lead', bob: 'member' } }, blue: { members: { cat: 'lead' } } },
  notes: { n1: { team: 'red' }, n2: { team: 'blue' } },
});
const capability = (id: string, kind: 'command' | 'query' = 'command') =>
  defineCapability({
    id,
    kind,
    input: jsonSchema(z.record(z.string(), z.string())),
    output: jsonSchema(z.strictObject({})),
    permission: { action: 'x', resourceType: 'X' },
    ui: { exception: 'test fixture' },
  });
const noteOf = (input: Record<string, unknown>, s: State) => own(s.notes, String(input.id))?.team;

const policy = definePolicy<State, Role>({
  roleOf: (s, principal, team) => own(s.teams, team)?.members[principal],
  integrations: [
    {
      is: (s, principal) => principal === s.integration,
      operations: ['note.sync', 'note.list'],
      events: (event) => event.resource.startsWith('note:'),
    },
  ],
  caller: {
    allow: (s, context) => Object.values(s.teams).some((t) => context.principalId in t.members),
  },
  operations: {
    'note.sync': 'integration',
    'note.list': 'open',
    'note.read': { container: noteOf, grant: (input) => `note:${String(input.id)}` },
    'note.edit': { container: noteOf, roles: ['lead'] },
    'note.start': { container: noteOf, person: true },
    'note.drop': { container: noteOf, roles: ['lead'], commit: 'previous' },
  },
  events: {
    note: { container: (id, s) => own(s.notes, id)?.team },
    team: (id, s, context) => !!own(s.teams, id)?.members[context.principalId],
  },
});

function decide(
  id: string,
  principalId: string,
  input: Record<string, unknown> = {},
  extra: Omit<Partial<AuthorizationRequest<State>>, 'context'> & {
    context?: Partial<ExecutionContext>;
  } = {},
): Decision {
  const kind = id === 'note.read' || id === 'note.list' ? 'query' : 'command';
  return policy.authorize({
    capability: capability(id, kind),
    input,
    phase: 'invoke',
    state: state(),
    ...extra,
    context: { workspaceId: 'w', principalId, ...extra.context },
  }) as Decision;
}

describe('definePolicy', () => {
  test('an unlisted operation is denied before anything else', () => {
    expect(decide('note.unknown', 'ann')).toEqual({ allowed: false, reason: 'NO_POLICY' });
  });

  test('an integration principal calls only its allowlist, and its operations are closed to others', () => {
    expect(decide('note.sync', 'sync-bot').allowed).toBe(true);
    expect(decide('note.list', 'sync-bot').allowed).toBe(true);
    expect(decide('note.edit', 'sync-bot', { id: 'n1' })).toEqual({
      allowed: false,
      reason: 'INTEGRATION_SCOPE',
    });
    expect(decide('note.sync', 'ann')).toEqual({ allowed: false, reason: 'INTEGRATION_ONLY' });
  });

  test('the caller gate runs before operation rules', () => {
    expect(decide('note.list', 'stranger')).toEqual({ allowed: false, reason: 'NOT_A_MEMBER' });
    expect(decide('note.list', 'bob').allowed).toBe(true);
  });

  test('container roles decide commands; any role reads', () => {
    expect(decide('note.edit', 'ann', { id: 'n1' }).allowed).toBe(true);
    expect(decide('note.edit', 'bob', { id: 'n1' }).allowed).toBe(false);
    expect(decide('note.read', 'bob', { id: 'n1' }).allowed).toBe(true);
    // A role in another container is no role here; an unresolved container is a denial.
    expect(decide('note.read', 'cat', { id: 'n1' }).allowed).toBe(false);
    expect(decide('note.read', 'ann', { id: 'missing' }).allowed).toBe(false);
    expect(decide('note.edit', 'bob', { id: 'n1' }, { phase: 'replay' }).allowed).toBe(true);
  });

  test('a resource-limited grant must name the resource the rule resolves', () => {
    const grant = { operations: ['note.read'], resources: ['note:n9'] };
    expect(decide('note.read', 'ann', { id: 'n1' }, { context: { grant } }).allowed).toBe(false);
    const named = { operations: ['note.read'], resources: ['note:n1'] };
    expect(decide('note.read', 'ann', { id: 'n1' }, { context: { grant: named } }).allowed).toBe(
      true,
    );
  });

  test('person-only operations refuse delegated runs', () => {
    expect(decide('note.start', 'bob', { id: 'n1' }).allowed).toBe(true);
    expect(decide('note.start', 'bob', { id: 'n1' }, { context: { runId: 'r1' } })).toEqual({
      allowed: false,
      reason: 'PERSON_ONLY',
    });
  });

  test('a commit is decided on both snapshots, or on the previous one only', () => {
    const moved = state();
    moved.notes.n1 = { team: 'blue' };
    // Moving a note to a team where the caller has no role is denied at commit.
    expect(
      decide(
        'note.edit',
        'ann',
        { id: 'n1' },
        { phase: 'commit', state: moved, previousState: state() },
      ).allowed,
    ).toBe(false);
    const dropped = state();
    delete dropped.notes.n1;
    expect(
      decide(
        'note.drop',
        'ann',
        { id: 'n1' },
        { phase: 'commit', state: dropped, previousState: state() },
      ).allowed,
    ).toBe(true);
    expect(
      decide('note.drop', 'ann', { id: 'n1' }, { phase: 'commit', state: dropped }).allowed,
    ).toBe(false);
  });

  test('events follow resource type rules; unlisted types and non-members see nothing', () => {
    const read = (resource: string, principalId: string) =>
      policy.canReadEvent({
        event: { cursor: 1, resource, revision: 1, type: 'changed', operation: 'x' },
        state: state(),
        context: { workspaceId: 'w', principalId },
      });
    expect(read('note:n1', 'bob')).toBe(true);
    expect(read('note:n2', 'bob')).toBe(false);
    expect(read('team:red', 'bob')).toBe(true);
    expect(read('other:1', 'ann')).toBe(false);
    expect(read('unprefixed', 'ann')).toBe(false);
    expect(read('note:n2', 'sync-bot')).toBe(true);
    expect(read('team:red', 'sync-bot')).toBe(false);
  });

  test('an allowlist that names an operation the policy does not list is a definition error', () => {
    expect(() =>
      definePolicy<State>({
        integrations: [{ is: () => true, operations: ['ghost'] }],
        operations: {},
        events: {},
      }),
    ).toThrow('Integration allowlist names an operation the policy does not: ghost');
  });
});

describe('membership', () => {
  const teams = defineMembership({
    id: 'team',
    container: { field: 'team', type: 'team', resourceType: 'Team', label: 'Team' },
    roles: z.enum(['lead', 'member']),
    manager: 'lead',
    description: 'Set a team role.',
  });
  function setup() {
    const membershipPolicy = definePolicy<State, Role>({
      roleOf: (s, principal, team) => own(s.teams, team)?.members[principal],
      operations: { [teams.setMember.id]: membershipRule(teams) },
      events: { team: { container: (id) => id } },
    });
    return createApplication({
      modules: [defineModule({ id: 'teams', capabilities: [teams.setMember] })],
      storage: createMemoryStorage<State>(state()),
      services: {},
      authorization: membershipPolicy,
      handlers: [
        membershipHandler<State, {}, typeof teams>(teams, {
          members: (s, team) => own(s.teams, team)?.members,
          reserved: (s, principal) => principal === s.integration,
        }),
      ],
    });
  }
  const as = (principalId: string) => ({ workspaceId: 'w', principalId });
  const set = (
    app: ReturnType<typeof setup>,
    by: string,
    input: { team: string; principalId: string; role: Role | null },
    key: string,
  ) => app.invoke({ operation: 'team.set-member', input, idempotencyKey: key }, as(by));

  test('a manager grants and removes roles, and each change is an authorization event', async () => {
    const app = setup();
    const granted = await set(app, 'ann', { team: 'red', principalId: 'dan', role: 'member' }, 'g');
    expect(granted.result).toEqual({
      team: 'red',
      members: { ann: 'lead', bob: 'member', dan: 'member' },
    });
    expect(granted.authorizationRevision).toBe(1);
    const removed = await set(app, 'ann', { team: 'red', principalId: 'dan', role: null }, 'r');
    expect(removed.result.members).toEqual({ ann: 'lead', bob: 'member' });
  });

  test('members cannot manage, nobody changes their own role, and reserved principals get none', async () => {
    const app = setup();
    await expect(
      set(app, 'bob', { team: 'red', principalId: 'dan', role: 'lead' }, 'b'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      set(app, 'ann', { team: 'red', principalId: 'ann', role: 'member' }, 'self'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'You cannot change your own team role' });
    await expect(
      set(app, 'ann', { team: 'red', principalId: 'sync-bot', role: 'member' }, 'bot'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A lead elsewhere has no role in this team.
    await expect(
      set(app, 'cat', { team: 'red', principalId: 'dan', role: 'member' }, 'cat'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
