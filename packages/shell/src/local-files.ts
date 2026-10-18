import type { BlobRef, CatalogOs, RawOsRequest } from '@agent-native/contracts';
import { claimCode } from './parse';

type FileHandler = Extract<CatalogOs['handlers'][number], { kind: 'file' }>;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/**
 * The declared file handler for a file, by the same rule the shell port matches with: the first
 * whose types list the name's extension or the reported media type. A shell reads a file only
 * when one exists, within its `maxBytes`, so files nothing declares are never read.
 */
export function fileHandlerFor(
  declarations: CatalogOs,
  name: string,
  mediaType?: string,
): FileHandler | undefined {
  const extension = extensionOf(name);
  for (const handler of declarations.handlers)
    if (
      handler.kind === 'file' &&
      handler.types.some(
        (type) =>
          (extension && type.extensions.includes(extension)) ||
          (mediaType && type.mediaTypes.includes(mediaType)),
      )
    )
      return handler;
  return undefined;
}

/**
 * The media type a file is uploaded as: the one the OS reported when the handler declares it,
 * otherwise the first the handler declares for the name's extension.
 */
function uploadMediaType(handler: FileHandler, name: string, reported?: string) {
  if (reported && handler.types.some((type) => type.mediaTypes.includes(reported))) return reported;
  const extension = extensionOf(name);
  return handler.types.find((type) => type.extensions.includes(extension))?.mediaTypes[0];
}

/** Store bytes in the instance's blob store as the shell's session; `undefined` when refused. */
export type BlobUpload = (bytes: Uint8Array, mediaType: string) => Promise<BlobRef | undefined>;

/**
 * The OS request for a file's bytes under its handler. A text payload travels inline as strict
 * UTF-8; a blob payload is uploaded first and travels as its reference. The upload is staged:
 * only a command the person confirms attaches it, and the blob store sweeps it otherwise.
 * `undefined` when the bytes exceed the handler's limit, are not text, or have no media type.
 */
export async function fileRequest(
  handler: FileHandler,
  name: string,
  bytes: Uint8Array,
  upload: BlobUpload,
  reportedMediaType?: string,
): Promise<RawOsRequest | undefined> {
  if (bytes.byteLength > handler.maxBytes) return undefined;
  if (handler.payload === 'text') {
    const text = strictText(bytes);
    if (text === undefined) return undefined;
    // A name without a declared extension, such as an Android content id, matches by type.
    const declared =
      reportedMediaType &&
      handler.types.some((type) => type.mediaTypes.includes(reportedMediaType));
    return { kind: 'file', name, text, ...(declared ? { mediaType: reportedMediaType } : {}) };
  }
  const mediaType = uploadMediaType(handler, name, reportedMediaType);
  if (!mediaType) return undefined;
  const blob = await upload(bytes, mediaType);
  return blob && { kind: 'file', name, mediaType: blob.mediaType, blob };
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
 * The OS request a browser landing URL carries. A protocol handler navigates to `/?os=<link>`, a
 * manifest shortcut to `/?os-shortcut=<id>` and the share target's redirect to
 * `/?os-share=<claim code>`; the landing must carry exactly one of them and nothing else, and the
 * request is checked again by the shell port like any other.
 */
export function landingRequest(search: string): RawOsRequest | undefined {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.length !== 1) return undefined;
  const value = params.get(keys[0]!)!;
  if (keys[0] === 'os' && value.length <= 2048) return { kind: 'url', url: value };
  if (keys[0] === 'os-shortcut' && /^[a-z0-9._-]{1,128}$/.test(value))
    return { kind: 'shortcut', id: value };
  if (keys[0] === 'os-share' && claimCode.test(value)) return { kind: 'claim', code: value };
  return undefined;
}
