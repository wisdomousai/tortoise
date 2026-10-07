import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createScopedAbility, matchesScope, scopeToSql, type PolicyRule, type Scope } from './casl';

describe('bounded CASL scopes', () => {
  test('CASL, memory and SQL agree including denial, boolean composition and null negation', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE records (id INTEGER, owner TEXT, archived INTEGER, label TEXT)');
    const rows = [
      { id: 1, owner: 'alice', archived: false, label: null },
      { id: 2, owner: 'bob', archived: false, label: 'public' },
      { id: 3, owner: 'alice', archived: true, label: 'private' },
      { id: 4, owner: 'nobody', archived: false, label: null },
    ];
    for (const row of rows)
      db.query('INSERT INTO records VALUES (?, ?, ?, ?)').run(
        row.id,
        row.owner,
        Number(row.archived),
        row.label,
      );
    const cases: PolicyRule[][] = [
      [],
      [{ action: 'read', subject: 'Record' }],
      [
        { action: 'read', subject: 'Record' },
        { action: 'read', subject: 'Record', inverted: true },
      ],
      [
        {
          action: 'read',
          subject: 'Record',
          conditions: { or: [{ eq: ['owner', 'alice'] }, { in: ['label', ['public', null]] }] },
        },
        {
          action: 'read',
          subject: 'Record',
          conditions: { eq: ['archived', true] },
          inverted: true,
        },
      ],
      [{ action: 'read', subject: 'Record', conditions: { not: { eq: ['label', 'private'] } } }],
      [{ action: 'read', subject: 'Record', conditions: { in: ['owner', []] } }],
      [{ action: 'read', subject: 'Record', conditions: { eq: ['label', null] } }],
    ];
    const fields = {
      owner: { column: 'owner', type: 'string' },
      archived: { column: 'archived', type: 'boolean' },
      label: { column: 'label', type: 'string', nullable: true },
      id: { column: 'id', type: 'number' },
    } as const;
    for (const rules of cases) {
      const { ability, scopeFor } = createScopedAbility(rules, fields);
      const scope = scopeFor('read', 'Record');
      const expected = rows
        .filter((row) => ability.can('read', { ...row, __type: 'Record' }))
        .map((row) => row.id);
      expect(rows.filter((row) => matchesScope(scope, row)).map((row) => row.id)).toEqual(expected);
      const sql = scopeToSql(scope, fields);
      expect(
        (
          db.query(`SELECT id FROM records WHERE ${sql.sql} ORDER BY id`).all(...sql.params) as {
            id: number;
          }[]
        ).map((row) => row.id),
      ).toEqual(expected);
    }
    db.close(true);
  });
  test('rejects unsupported and unsafe policies and maps values only through parameters', () => {
    expect(() =>
      createScopedAbility(
        [
          { action: 'read', subject: 'Record', inverted: true },
          { action: 'read', subject: 'Record' },
        ],
        {},
      ),
    ).toThrow('Allow after deny');
    expect(() => createScopedAbility([{ action: 'manage', subject: 'Record' }], {})).toThrow(
      'Wildcard',
    );
    expect(() =>
      scopeToSql({ gt: ['id', 3] } as unknown as Scope, { id: { column: 'id', type: 'number' } }),
    ).toThrow();
    expect(() =>
      scopeToSql({ eq: ['secret', 'x'] }, { id: { column: 'id', type: 'number' } }),
    ).toThrow();
    expect(() =>
      scopeToSql({ eq: ['id', 1] }, { id: { column: 'id; DELETE', type: 'number' } }),
    ).toThrow();
    expect(() => scopeToSql({ eq: ['id', '1'] }, { id: { column: 'id', type: 'number' } })).toThrow(
      'column type',
    );
    expect(() =>
      scopeToSql({ eq: ['archived', 0] }, { archived: { column: 'archived', type: 'boolean' } }),
    ).toThrow('column type');
    const result = scopeToSql(
      { eq: ['label', "x' OR 1=1 --"] },
      { label: { column: 'label', type: 'string' } },
    );
    expect(result.sql).not.toContain("x'");
    expect(result.params).toEqual(["x' OR 1=1 --"]);
  });
  test('field restrictions are instance-specific and cannot become row scopes', () => {
    const { ability, scopeFor } = createScopedAbility(
      [
        {
          action: 'read',
          subject: 'Record',
          fields: ['label'],
          conditions: { eq: ['owner', 'alice'] },
        },
      ],
      { label: { column: 'label', type: 'string' }, owner: { column: 'owner', type: 'string' } },
    );
    expect(ability.can('read', { __type: 'Record', owner: 'alice' }, 'label')).toBe(true);
    expect(ability.can('read', { __type: 'Record', owner: 'bob' }, 'label')).toBe(false);
    expect(ability.can('read', { __type: 'Record', owner: 'alice' }, 'owner')).toBe(false);
    expect(() => scopeFor('read', 'Record')).toThrow('explicit field-independent');
  });
  test('mutating authored rules or returned scopes cannot modify the validated ability', () => {
    const rules: PolicyRule[] = [
      { action: 'read', subject: 'Record', conditions: { eq: ['owner', 'alice'] } },
    ];
    const { ability, scopeFor } = createScopedAbility(rules, {
      owner: { column: 'owner', type: 'string' },
    });
    rules[0]!.conditions = { eq: ['owner', 'bob'] };
    const scope = scopeFor('read', 'Record');
    Object.assign(scope, { and: [] });
    expect(ability.can('read', { __type: 'Record', owner: 'bob' })).toBe(false);
    expect(matchesScope(scopeFor('read', 'Record'), { owner: 'bob' })).toBe(false);
  });
});
