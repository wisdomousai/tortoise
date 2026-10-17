import {
  isBlobRef,
  linkPathSegments,
  type JsonValue,
  type OsFileHandler,
  type OsHandler,
  type OsIntentHandler,
  type OsLinkHandler,
  type OsShareHandler,
  type RawOsRequest,
} from '@agent-native/contracts';
import { OsRequestError } from './parse';
import { shortcutIdOf } from './shortcuts';

/** Values a handler's templates may name: link params, extras and request fields. */
export type OsRequestValues = Readonly<Record<string, JsonValue>>;

export interface OsMatch<H extends OsHandler = OsHandler> {
  readonly handler: H;
  readonly values: OsRequestValues;
  /** What the person is shown as the origin: a file name, a link's host, the sender. */
  readonly label?: string;
}

export interface MatchOptions {
  /** URL schemes this application answers, without the colon: its scheme and `web+` form. */
  readonly schemes: readonly string[];
  /** Hosts whose `https` links verified link handlers accept. */
  readonly linkHosts?: readonly string[];
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

function parseSchema(
  handler: OsHandler,
  schema: { parse(value: unknown): unknown } | undefined,
  value: Record<string, JsonValue>,
): Record<string, JsonValue> | undefined {
  if (!schema) return Object.keys(value).length ? undefined : value;
  try {
    return schema.parse(value) as Record<string, JsonValue>;
  } catch {
    throw new OsRequestError('invalid', `Request does not fit ${handler.id}`);
  }
}

/** The path of a URL this application answers, or undefined when the URL is not its own. */
function linkPath(
  url: URL,
  options: MatchOptions,
): { path: string; verified: boolean } | undefined {
  const scheme = url.protocol.slice(0, -1);
  if (options.schemes.includes(scheme))
    // `<scheme>://tasks/1` parses `tasks` as the host; `<scheme>:///tasks/1` leaves it empty.
    return { path: `${url.host ? `/${url.host}` : ''}${url.pathname}`, verified: false };
  if (scheme === 'https' && !url.port && options.linkHosts?.includes(url.hostname))
    return { path: url.pathname, verified: true };
  return undefined;
}

function matchPath(
  handler: OsLinkHandler,
  parts: readonly string[],
): Record<string, string> | undefined {
  const segments = linkPathSegments(handler.path);
  if (segments.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, segment] of segments.entries()) {
    const part = parts[index]!;
    if ('literal' in segment) {
      if (segment.literal !== part) return undefined;
    } else params[segment.param] = part;
  }
  return params;
}

function matchLink(
  handlers: readonly OsLinkHandler[],
  raw: string,
  options: MatchOptions,
): OsMatch | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OsRequestError('invalid', 'Not a URL');
  }
  if (url.username || url.password || url.hash)
    throw new OsRequestError('invalid', 'Links carry no credentials or fragment');
  const own = linkPath(url, options);
  if (!own) return undefined;
  let parts: string[];
  try {
    parts = own.path.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent);
  } catch {
    throw new OsRequestError('invalid', 'Malformed link path');
  }
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f/]/.test(part)))
    throw new OsRequestError('invalid', 'Malformed link path');
  for (const handler of handlers) {
    if (own.verified && !handler.verified) continue;
    const params = matchPath(handler, parts);
    if (!params) continue;
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(query, key) || Object.hasOwn(params, key))
        throw new OsRequestError('invalid', `Repeated link parameter ${key}`);
      query[key] = value;
    }
    const values = parseSchema(handler, handler.params, { ...params, ...query });
    if (!values) throw new OsRequestError('invalid', `${handler.id} takes no query`);
    return { handler, values, ...(own.verified ? { label: url.hostname } : {}) };
  }
  return undefined;
}

function matchFile(
  handlers: readonly OsFileHandler[],
  raw: Extract<RawOsRequest, { kind: 'file' }>,
): OsMatch | undefined {
  const dot = raw.name.lastIndexOf('.');
  const extension = dot > 0 ? raw.name.slice(dot + 1).toLowerCase() : '';
  const handler = handlers.find((item) =>
    item.types.some(
      (type) =>
        (extension && type.extensions.includes(extension)) ||
        (raw.mediaType && type.mediaTypes.includes(raw.mediaType)),
    ),
  );
  if (!handler) return undefined;
  const size =
    handler.payload === 'text'
      ? raw.text === undefined
        ? -1
        : utf8Length(raw.text)
      : isBlobRef(raw.blob)
        ? raw.blob.size
        : -1;
  if (size < 0)
    throw new OsRequestError('invalid', `${handler.id} needs the file's ${handler.payload}`);
  if (size > handler.maxBytes)
    throw new OsRequestError('too-large', `${raw.name} is larger than ${handler.id} accepts`);
  // A blob carries its own media type; it must be one the handler declares and agree with the
  // type the request reports, so a file cannot match by one type and be stored as another.
  if (
    handler.payload === 'blob' &&
    ((raw.mediaType !== undefined && raw.mediaType !== raw.blob!.mediaType) ||
      !handler.types.some((type) => type.mediaTypes.includes(raw.blob!.mediaType)))
  )
    throw new OsRequestError('invalid', `${raw.name} is not a media type ${handler.id} declares`);
  const values: Record<string, JsonValue> = {
    'file.name': raw.name,
    'file.stem': dot > 0 ? raw.name.slice(0, dot) : raw.name,
    'file.mediaType': (handler.payload === 'blob' ? raw.blob!.mediaType : raw.mediaType) ?? '',
  };
  if (handler.payload === 'text') values['file.text'] = raw.text!;
  else values['file.blob'] = raw.blob as unknown as JsonValue;
  return { handler, values, label: raw.name };
}

function matchShare(
  handlers: readonly OsShareHandler[],
  raw: Extract<RawOsRequest, { kind: 'share' }>,
): OsMatch | undefined {
  const handler = handlers.find(
    ({ accepts }) =>
      (raw.text !== undefined && accepts.text) ||
      (raw.url !== undefined && accepts.url) ||
      (raw.blob !== undefined && !!raw.mediaType && accepts.mediaTypes?.includes(raw.mediaType)),
  );
  if (!handler) return undefined;
  const size = utf8Length(raw.text ?? '') + utf8Length(raw.url ?? '') + (raw.blob?.size ?? 0);
  if (size > handler.maxBytes)
    throw new OsRequestError('too-large', `The share is larger than ${handler.id} accepts`);
  const values: Record<string, JsonValue> = {};
  if (raw.text !== undefined && handler.accepts.text) values.text = raw.text;
  if (raw.url !== undefined && handler.accepts.url) values.url = raw.url;
  if (raw.title !== undefined) values.title = raw.title;
  if (
    raw.blob !== undefined &&
    raw.mediaType &&
    handler.accepts.mediaTypes?.includes(raw.mediaType)
  )
    values.blob = raw.blob as unknown as JsonValue;
  return { handler, values, ...(raw.source ? { label: raw.source } : {}) };
}

function matchIntent(
  handlers: readonly OsIntentHandler[],
  raw: Extract<RawOsRequest, { kind: 'intent' }>,
): OsMatch | undefined {
  const handler = handlers.find(
    (item) =>
      item.action === raw.action &&
      (item.categories ?? []).every((category) => raw.categories?.includes(category)) &&
      (!item.data?.mimeType || item.data.mimeType === raw.mimeType) &&
      (!item.data?.scheme || raw.data?.startsWith(`${item.data.scheme}:`)),
  );
  if (!handler) return undefined;
  const extras = parseSchema(handler, handler.extras, raw.extras ?? {});
  if (!extras) throw new OsRequestError('invalid', `${handler.id} takes no extras`);
  return {
    handler,
    values: { ...extras, ...(raw.data !== undefined ? { data: raw.data } : {}) },
    ...(raw.source ? { label: raw.source } : {}),
  };
}

/**
 * The handler that accepts `raw`, first match in declaration order, with the values its
 * templates may use. Undefined when no handler of the request's kind matches. Throws
 * `OsRequestError` when the request is addressed to a handler but malformed or too large, so
 * the refusal says why. Parameters and extras are validated with the handler's own schema.
 */
export function matchOsRequest(
  handlers: readonly OsHandler[],
  raw: RawOsRequest,
  options: MatchOptions,
): OsMatch | undefined {
  const of = <K extends OsHandler['kind']>(kind: K) =>
    handlers.filter((item): item is Extract<OsHandler, { kind: K }> => item.kind === kind);
  switch (raw.kind) {
    case 'url': {
      // A launcher entry opens `<scheme>:///?os-shortcut=<id>`; it is read before links.
      const shortcut = shortcutIdOf(raw.url, options.schemes);
      if (shortcut === undefined) return matchLink(of('link'), raw.url, options);
      const handler = of('shortcut').find((item) => item.id === shortcut);
      return handler ? { handler, values: {} } : undefined;
    }
    case 'file':
      return matchFile(of('file'), raw);
    case 'share':
      return matchShare(of('share'), raw);
    case 'intent':
      return matchIntent(of('intent'), raw);
    case 'shortcut': {
      const handler = of('shortcut').find((item) => item.id === raw.id);
      return handler ? { handler, values: {} } : undefined;
    }
    case 'reply': {
      const handler = of('reply').find((item) => item.id === raw.handler);
      return handler ? { handler, values: {} } : undefined;
    }
    case 'claim':
      // The plugin that issued the code resolves it into the request it stands for first.
      return undefined;
  }
}
