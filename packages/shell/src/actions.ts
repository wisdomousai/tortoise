import {
  templatePlaceholders,
  type CatalogOsAction,
  type JsonObject,
  type JsonValue,
  type OsAction,
  type OsInstruction,
} from '@agent-native/contracts';

/** Why an action was refused while it was built. */
export class OsActionError extends Error {
  constructor(
    readonly reason: 'invalid' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}

function parsed(
  action: OsAction,
  schema: { parse(value: unknown): unknown } | undefined,
  params: JsonObject | undefined,
): Record<string, JsonValue> {
  if (!schema) {
    if (params && Object.keys(params).length)
      throw new OsActionError('invalid', `${action.id} takes no parameters`);
    return {};
  }
  try {
    return schema.parse(params ?? {}) as Record<string, JsonValue>;
  } catch {
    throw new OsActionError('invalid', `Parameters do not fit ${action.id}`);
  }
}

function scalar(name: string, value: JsonValue | undefined): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    throw new OsActionError('invalid', `${name} must be text, a number or a boolean`);
  return String(value);
}

/**
 * The URL an open action names: placeholders in the path are filled with encoded values and the
 * remaining parameters become the query. `encodeURIComponent` encodes `/`, `?`, `#`, `@` and `:`,
 * so a value stays inside its own path segment; the result is parsed again and must keep the
 * template's scheme and host.
 */
export function openUrl(template: string, values: Readonly<Record<string, JsonValue>>): string {
  const names = new Set(templatePlaceholders(template));
  const url = new URL(
    template.replace(/\{([^}]+)\}/g, (_, name: string) =>
      encodeURIComponent(scalar(name, values[name])),
    ),
  );
  const fixed = new URL(template.replace(/\{[^}]+\}/g, 'x'));
  if (url.protocol !== fixed.protocol || url.host !== fixed.host || url.username || url.password)
    throw new OsActionError('invalid', 'A parameter changed the URL beyond its path segment');
  for (const [name, value] of Object.entries(values))
    if (!names.has(name) && value !== undefined && value !== null)
      url.searchParams.append(name, scalar(name, value));
  return url.href;
}

/** A path below a root: relative, no empty, `.` or `..` segment, no backslash or NUL. */
function relativePath(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length > 1024 || /[\\\u0000]/.test(value))
    throw new OsActionError('invalid', 'path must be a relative path');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'))
    throw new OsActionError('invalid', 'path must stay below its root');
  return segments.join('/');
}

/**
 * Build what an adapter executes from a declared action and the caller's parameters. Nothing
 * from the caller becomes a scheme, host, directory root, package or intent action: those come
 * from the declaration and `root`, which resolves a plugin path setting. Notifications are
 * built by the plugin that issues their reply nonces, so a `notify` action is refused here.
 */
export function buildInstruction(
  action: OsAction,
  params: JsonObject | undefined,
  root: (key: string) => string | undefined,
): OsInstruction {
  switch (action.kind) {
    case 'open':
      return {
        kind: 'open',
        action: action.id,
        url: openUrl(action.url, parsed(action, action.params, params)),
      };
    case 'reveal':
    case 'open-file': {
      const base = root(action.root);
      if (!base)
        throw new OsActionError('unsupported', `${action.id} has no root directory configured`);
      if (!params || Object.keys(params).some((key) => key !== 'path'))
        throw new OsActionError('invalid', `${action.id} takes only a path`);
      return {
        kind: action.kind,
        action: action.id,
        path: `${base.replace(/\/+$/, '')}/${relativePath(params.path)}`,
      };
    }
    case 'share': {
      const allowed = [
        ...(action.accepts.text ? ['text', 'title'] : []),
        ...(action.accepts.url ? ['url', 'title'] : []),
      ];
      const extra = Object.keys(params ?? {}).find((key) => !allowed.includes(key));
      if (extra) throw new OsActionError('invalid', `${action.id} does not share ${extra}`);
      const field = (name: string, max: number) => {
        const value = params?.[name];
        if (value === undefined) return {};
        if (typeof value !== 'string' || value.length > max)
          throw new OsActionError('invalid', `${name} must be text`);
        return { [name]: value };
      };
      return {
        kind: 'share',
        action: action.id,
        ...field('text', 65_536),
        ...field('url', 2048),
        ...field('title', 200),
      };
    }
    case 'intent':
      return {
        kind: 'intent',
        action: action.id,
        intent: action.action,
        package: action.package,
        ...(action.extras
          ? { extras: parsed(action, action.extras, params) as JsonObject }
          : (parsed(action, undefined, params), {})),
      };
    case 'notify':
      throw new OsActionError('unsupported', `${action.id} is delivered by its outbox target`);
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type TextProperty = {
  type?: unknown;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  maxLength?: number;
};

/**
 * Text values checked against the JSON form of a parameter schema: an object without unknown
 * keys, with its required keys, whose properties are text within `const`, `enum`, `pattern` and
 * `maxLength`. It needs only the JSON form, so it works on declarations read over HTTP; anything
 * it cannot check, such as a numeric property, fails.
 */
function fitsText(schema: JsonObject | undefined, values: Readonly<Record<string, string>>) {
  if (!schema) return Object.keys(values).length === 0;
  const properties = (schema.properties ?? {}) as Record<string, TextProperty>;
  const required = (schema.required ?? []) as string[];
  if (required.some((name) => !Object.hasOwn(values, name))) return false;
  return Object.entries(values).every(([name, value]) => {
    const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!property || property.type !== 'string') return false;
    if (property.const !== undefined && property.const !== value) return false;
    if (property.enum && !property.enum.includes(value)) return false;
    if (property.maxLength !== undefined && value.length > property.maxLength) return false;
    return property.pattern === undefined || new RegExp(property.pattern).test(value);
  });
}

/**
 * The declared open action and parameters that would build `url`, so a shell can check a URL a
 * page asked to open against the declarations instead of a hard-coded rule. The URL must keep
 * the template's origin and path shape, carry no credentials, fragment or repeated query
 * parameter, and its values must fit the JSON form of the action's schema. Build the URL again
 * from the result (`openUrl`) rather than opening the one given.
 */
export function openActionFor(
  actions: readonly CatalogOsAction[],
  url: string,
): { action: string; params: Record<string, string> } | undefined {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }
  if (target.username || target.password || target.hash) return undefined;
  for (const action of actions) {
    if (action.kind !== 'open') continue;
    const names = templatePlaceholders(action.url);
    // Each placeholder becomes an encoded `{}`, which nothing else in a template can produce.
    const shape = new URL(action.url.replace(/\{[^}]+\}/g, '%7B%7D'));
    const pattern = new RegExp(
      `^${escapeRegExp(`${shape.origin}${shape.pathname}`).replace(/%7B%7D/g, '([^/?#]+)')}$`,
    );
    const found = `${target.origin}${target.pathname}`.match(pattern);
    if (!found) continue;
    const params: Record<string, string> = {};
    try {
      names.forEach((name, index) => (params[name] = decodeURIComponent(found[index + 1]!)));
    } catch {
      continue;
    }
    let repeated = false;
    for (const [name, value] of target.searchParams) {
      if (Object.hasOwn(params, name)) repeated = true;
      params[name] = value;
    }
    if (!repeated && fitsText(action.params, params)) return { action: action.id, params };
  }
  return undefined;
}
