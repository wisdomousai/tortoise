import {
  isBlobRef,
  mediaTypePattern,
  type JsonObject,
  type RawOsRequest,
} from '@agent-native/contracts';

/** Why a raw request was refused before matching. */
export class OsRequestError extends Error {
  constructor(
    readonly reason: 'invalid' | 'too-large',
    message: string,
  ) {
    super(message);
  }
}

const limits = { url: 2048, name: 255, label: 200, text: 1_048_576, token: 128 } as const;
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const controlCharacters = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]',
);

function invalid(message: string): never {
  throw new OsRequestError('invalid', message);
}
function optionalText(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${field} must be text`);
  if (value.length > max) throw new OsRequestError('too-large', `${field} is too long`);
  return value;
}
/** One line of display text: no control or bidirectional override characters. */
function label(value: unknown, field: string): string | undefined {
  const text = optionalText(value, limits.label, field);
  if (text !== undefined && controlCharacters.test(text))
    invalid(`${field} has control characters`);
  return text;
}
function token(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    invalid(`${field} is not an identifier`);
  return value;
}
function mediaType(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    !mediaTypePattern.test(value.toLowerCase())
  )
    invalid(`${field} is not a media type`);
  return value.toLowerCase();
}
function only(value: Record<string, unknown>, keys: readonly string[]) {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) invalid(`Unknown field ${extra}`);
}

function file(value: Record<string, unknown>): RawOsRequest {
  only(value, ['kind', 'name', 'mediaType', 'text', 'blob', 'source']);
  const name = label(value.name, 'name');
  if (!name || name.length > limits.name || /[\\/]/.test(name) || name === '.' || name === '..')
    invalid('A file name is one path segment');
  if (value.blob !== undefined && !isBlobRef(value.blob)) invalid('Invalid blob reference');
  return {
    kind: 'file',
    name,
    ...(value.mediaType !== undefined
      ? { mediaType: mediaType(value.mediaType, 'mediaType') }
      : {}),
    ...(value.text !== undefined ? { text: optionalText(value.text, limits.text, 'text')! } : {}),
    ...(value.blob !== undefined ? { blob: value.blob as never } : {}),
    ...(value.source !== undefined ? { source: label(value.source, 'source')! } : {}),
  };
}

function share(value: Record<string, unknown>): RawOsRequest {
  only(value, ['kind', 'text', 'url', 'title', 'mediaType', 'blob', 'source']);
  if (value.blob !== undefined && !isBlobRef(value.blob)) invalid('Invalid blob reference');
  const request = {
    kind: 'share' as const,
    ...(value.text !== undefined ? { text: optionalText(value.text, limits.text, 'text')! } : {}),
    ...(value.url !== undefined ? { url: optionalText(value.url, limits.url, 'url')! } : {}),
    ...(value.title !== undefined ? { title: label(value.title, 'title')! } : {}),
    ...(value.mediaType !== undefined
      ? { mediaType: mediaType(value.mediaType, 'mediaType') }
      : {}),
    ...(value.blob !== undefined ? { blob: value.blob as never } : {}),
    ...(value.source !== undefined ? { source: label(value.source, 'source')! } : {}),
  };
  if (request.text === undefined && request.url === undefined && !('blob' in request))
    invalid('A share carries text, a URL or a file');
  return request;
}

function intent(value: Record<string, unknown>): RawOsRequest {
  only(value, ['kind', 'action', 'categories', 'data', 'mimeType', 'extras', 'source']);
  const categories = value.categories;
  if (categories !== undefined && (!Array.isArray(categories) || categories.length > 16))
    invalid('Invalid intent categories');
  if (
    value.extras !== undefined &&
    (!plain(value.extras) || JSON.stringify(value.extras).length > limits.text)
  )
    invalid('Invalid intent extras');
  return {
    kind: 'intent',
    action: token(value.action, 'action'),
    ...(categories ? { categories: categories.map((item) => token(item, 'category')) } : {}),
    ...(value.data !== undefined ? { data: optionalText(value.data, limits.url, 'data')! } : {}),
    ...(value.mimeType !== undefined ? { mimeType: mediaType(value.mimeType, 'mimeType') } : {}),
    ...(value.extras !== undefined ? { extras: value.extras as JsonObject } : {}),
    ...(value.source !== undefined ? { source: label(value.source, 'source')! } : {}),
  };
}

/**
 * Check a raw OS request's syntax and size: known kind and fields, text within limits, one-line
 * labels, identifiers where the platform gives identifiers. It says nothing about whether any
 * handler accepts the request. Throws `OsRequestError`.
 */
export function parseRawOsRequest(value: unknown): RawOsRequest {
  if (!plain(value)) invalid('An OS request is an object');
  switch (value.kind) {
    case 'url':
      only(value, ['kind', 'url', 'source']);
      if (typeof value.url !== 'string') invalid('url must be text');
      if (value.url.length > limits.url) throw new OsRequestError('too-large', 'url is too long');
      return {
        kind: 'url',
        url: value.url,
        ...(value.source !== undefined ? { source: label(value.source, 'source')! } : {}),
      };
    case 'file':
      return file(value);
    case 'share':
      return share(value);
    case 'intent':
      return intent(value);
    case 'shortcut':
      only(value, ['kind', 'id']);
      return { kind: 'shortcut', id: token(value.id, 'id') };
    case 'reply':
      only(value, ['kind', 'handler', 'nonce', 'action', 'text']);
      return {
        kind: 'reply',
        handler: token(value.handler, 'handler'),
        nonce: token(value.nonce, 'nonce'),
        action: token(value.action, 'action'),
        ...(value.text !== undefined ? { text: optionalText(value.text, 4096, 'text')! } : {}),
      };
    default:
      return invalid('Unknown OS request kind');
  }
}
