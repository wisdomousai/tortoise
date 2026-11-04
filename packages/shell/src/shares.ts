import type { CatalogOs, RawOsRequest } from '@tortoise/contracts';
import type { BlobUpload } from './local-files';

type ShareHandler = Extract<CatalogOs['handlers'][number], { kind: 'share' }>;

/** Most items one share may carry; the rest are ignored. */
export const maxSharedItems = 4;

/**
 * The declared share handler for a shared file, by the same rule the shell port matches with:
 * the first whose accepted media types list the file's. A shell reads a shared file only when
 * one exists, within its `maxBytes`, so files nothing accepts are never read.
 */
export function shareHandlerFor(
  declarations: CatalogOs | undefined,
  mediaType: string | undefined,
): ShareHandler | undefined {
  if (!mediaType) return undefined;
  const type = mediaType.toLowerCase();
  return (declarations?.handlers ?? []).find(
    (handler): handler is ShareHandler =>
      handler.kind === 'share' && !!handler.accepts.mediaTypes?.includes(type),
  );
}

/**
 * The share request for a shared file's bytes: uploaded to the blob store first as the media
 * type the sender reported, which the handler accepts, and submitted as its reference with the
 * file name as the title. `undefined` when the file does not fit the handler or the upload is
 * refused.
 */
export async function shareFileRequest(
  handler: ShareHandler,
  name: string | undefined,
  mediaType: string,
  bytes: Uint8Array,
  upload: BlobUpload,
): Promise<RawOsRequest | undefined> {
  if (bytes.byteLength > handler.maxBytes) return undefined;
  const blob = await upload(bytes, mediaType.toLowerCase());
  if (!blob) return undefined;
  return {
    kind: 'share',
    mediaType: mediaType.toLowerCase(),
    blob,
    ...(name ? { title: name.slice(0, 200) } : {}),
  };
}
