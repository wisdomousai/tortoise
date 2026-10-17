import type { CatalogOs, RawOsRequest } from '@agent-native/contracts';

/**
 * The declared text file handler for a file name's extension. A shell reads a file only when one
 * exists, within its `maxBytes`, so files nothing declares are never read.
 */
export function textFileHandler(declarations: CatalogOs, name: string) {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  for (const handler of declarations.handlers)
    if (
      handler.kind === 'file' &&
      handler.payload === 'text' &&
      handler.types.some((type) => type.extensions.includes(extension))
    )
      return handler;
  return undefined;
}

/** Bytes as strict UTF-8 text; `undefined` for anything that does not decode. */
export function strictText(bytes: ArrayBuffer | Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The OS request a browser landing URL carries. A protocol handler navigates to `/?os=<link>` and
 * a manifest shortcut to `/?os-shortcut=<id>`; the landing must carry exactly one of them and
 * nothing else, and the request is checked again by the shell port like any other.
 */
export function landingRequest(search: string): RawOsRequest | undefined {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.length !== 1) return undefined;
  const value = params.get(keys[0]!)!;
  if (keys[0] === 'os' && value.length <= 2048) return { kind: 'url', url: value };
  if (keys[0] === 'os-shortcut' && /^[a-z0-9._-]{1,128}$/.test(value))
    return { kind: 'shortcut', id: value };
  return undefined;
}
