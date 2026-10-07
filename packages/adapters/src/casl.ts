import { Ability } from '@casl/ability';

export type Scalar = string | number | boolean | null;
/** Private adapter scope: scalar columns only; missing values never equal null. */
export type Scope =
  | { eq: readonly [string, Scalar] }
  | { in: readonly [string, readonly Scalar[]] }
  | { and: readonly Scope[] }
  | { or: readonly Scope[] }
  | { not: Scope };
export type PolicyRule = {
  action: string;
  subject: string;
  fields?: string[];
  conditions?: Scope;
  inverted?: boolean;
};
export type FieldMappings = Readonly<
  Record<
    string,
    {
      readonly column: string;
      readonly type: 'string' | 'number' | 'boolean';
      readonly nullable?: boolean;
    }
  >
>;
const scalar = (v: unknown): v is Scalar =>
  v === null ||
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v));

export function validateScope(scope: Scope, fields: FieldMappings): void {
  if (!scope || typeof scope !== 'object' || Object.keys(scope).length !== 1)
    throw new Error('Unsupported policy condition');
  if ('eq' in scope || 'in' in scope) {
    const pair = 'eq' in scope ? scope.eq : scope.in;
    if (!Array.isArray(pair) || pair.length !== 2 || !Object.hasOwn(fields, pair[0]))
      throw new Error('Unregistered policy field');
    if ('eq' in scope ? !scalar(pair[1]) : !Array.isArray(pair[1]) || !pair[1].every(scalar))
      throw new Error('Unsupported policy scalar');
    const mapping = fields[pair[0]]!;
    const values: readonly unknown[] = 'eq' in scope ? [pair[1]] : (pair[1] as readonly unknown[]);
    if (
      values.some((value) => (value === null ? !mapping.nullable : typeof value !== mapping.type))
    )
      throw new Error('Policy value does not match registered column type');
  } else if ('and' in scope || 'or' in scope) {
    const children = 'and' in scope ? scope.and : scope.or;
    if (!Array.isArray(children)) throw new Error('Unsupported boolean condition');
    children.forEach((child) => validateScope(child, fields));
  } else if ('not' in scope) validateScope(scope.not, fields);
  else throw new Error('Unsupported policy condition');
}

export function matchesScope(scope: Scope, object: Record<string, unknown>): boolean {
  if ('eq' in scope)
    return Object.hasOwn(object, scope.eq[0]) && object[scope.eq[0]] === scope.eq[1];
  if ('in' in scope)
    return (
      Object.hasOwn(object, scope.in[0]) &&
      scope.in[1].some((value) => value === object[scope.in[0]])
    );
  if ('and' in scope) return scope.and.every((child) => matchesScope(child, object));
  if ('or' in scope) return scope.or.some((child) => matchesScope(child, object));
  return !matchesScope(scope.not, object);
}

/** SQL expressions use two-valued truth, including negation of nullable columns. */
export function scopeToSql(
  scope: Scope,
  fields: FieldMappings,
): { sql: string; params: (string | number | null)[] } {
  validateScope(scope, fields);
  const params: (string | number | null)[] = [];
  const column = (field: string) => {
    const mapped = fields[field]!.column;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(mapped)) throw new Error('Unsafe registered SQL column');
    return `"${mapped}"`;
  };
  const equal = (field: string, value: Scalar) => {
    if (value === null) return `${column(field)} IS NULL`;
    params.push(typeof value === 'boolean' ? Number(value) : value);
    return `COALESCE(${column(field)} = ?, 0)`;
  };
  const visit = (node: Scope): string => {
    if ('eq' in node) return equal(...node.eq);
    if ('in' in node)
      return `(${node.in[1].map((value) => equal(node.in[0], value)).join(' OR ') || '0'})`;
    if ('and' in node) return `(${node.and.map(visit).join(' AND ') || '1'})`;
    if ('or' in node) return `(${node.or.map(visit).join(' OR ') || '0'})`;
    return `(NOT ${visit(node.not)})`;
  };
  return { sql: visit(scope), params };
}

/** v1 rejects priority reversal and field-specific row grants rather than guessing. */
export function createScopedAbility(rules: readonly PolicyRule[], fields: FieldMappings) {
  // Snapshot authored rules so later caller mutation cannot bypass composition validation.
  rules = structuredClone(rules);
  const denied = new Set<string>();
  for (const rule of rules) {
    if (rule.action === 'manage' || rule.subject === 'all')
      throw new Error('Wildcard policy actions and subjects are unsupported');
    const key = `${rule.action}:${rule.subject}`;
    if (rule.inverted) denied.add(key);
    else if (denied.has(key))
      throw new Error('Allow after deny is unsupported in the v1 policy profile');
    if (rule.conditions) validateScope(rule.conditions, fields);
    if (rule.fields?.some((field) => !Object.hasOwn(fields, field)))
      throw new Error('Unregistered policy field');
  }
  const ability = new Ability<[string, Record<string, unknown> | string], Scope>([...rules], {
    detectSubjectType: (object) => String(object.__type),
    conditionsMatcher: (condition) => (object) =>
      matchesScope(condition, object as Record<string, unknown>),
    fieldMatcher: (permitted) => (field) => permitted.includes(field),
  });
  const scopeFor = (action: string, subject: string): Scope => {
    const relevant = rules.filter((rule) => rule.action === action && rule.subject === subject);
    if (relevant.some((rule) => rule.fields))
      throw new Error('Row scopes require explicit field-independent rules');
    const allows = relevant
      .filter((rule) => !rule.inverted)
      .map((rule) => rule.conditions ?? ({ and: [] } as Scope));
    const denies = relevant
      .filter((rule) => rule.inverted)
      .map((rule) => rule.conditions ?? ({ and: [] } as Scope));
    return structuredClone({ and: [{ or: allows }, { not: { or: denies } }] });
  };
  return {
    ability: Object.freeze({
      can: ability.can.bind(ability),
      cannot: ability.cannot.bind(ability),
    }),
    scopeFor,
  };
}
