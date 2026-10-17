import type { CatalogOs } from '@agent-native/contracts';
import { shareHandlerFor, webShareTargetPath } from '@agent-native/shell';
import type { HeldShare, HeldShares } from './held';

/** Room for the multipart boundaries, headers and the text fields around a file. */
const overheadBytes = 1_114_112;
const formTypes = ['multipart/form-data', 'application/x-www-form-urlencoded'];
/** The part of a parsed form read here; React Native's `FormData` type has no `get`. */
type Form = { get(name: string): unknown };

const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
const field = (form: Form, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' && value.length ? value : undefined;
};

/** The largest share any declared handler accepts, plus the form's own overhead. */
function bodyLimit(os: CatalogOs | undefined) {
  const shares = (os?.handlers ?? []).filter((handler) => handler.kind === 'share');
  return Math.max(0, ...shares.map((handler) => handler.maxBytes)) + overheadBytes;
}

/**
 * The web share target: the browser posts what another app shared to `webShareTargetPath` as a
 * top-level navigation, from no site and with no session the host could trust. The post is
 * held, not submitted: the response redirects to `/?os-share=<code>`, and the landing page
 * claims the code as its own session. A post larger than any share handler accepts, of another
 * form type or without a length is refused unread; a file no share handler accepts is dropped
 * unread.
 */
export async function shareTargetRoute(
  request: Request,
  os: () => CatalogOs | undefined,
  held: HeldShares,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== webShareTargetPath) return undefined;
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!formTypes.includes(type)) return new Response('Unsupported form', { status: 415 });
  const length = Number(request.headers.get('content-length') ?? Number.NaN);
  if (!Number.isSafeInteger(length)) return new Response('Length required', { status: 411 });
  if (length > bodyLimit(os())) return new Response('Too large', { status: 413 });
  let form: Form;
  try {
    form = (await request.formData()) as unknown as Form;
  } catch {
    return new Response('Malformed form', { status: 400 });
  }
  const title = field(form, 'title');
  const text = field(form, 'text');
  const link = field(form, 'url');
  const share: HeldShare = {
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    ...(link ? { url: link } : {}),
  };
  const upload = form.get('file');
  if (upload instanceof File) {
    const mediaType = upload.type.toLowerCase();
    const handler = shareHandlerFor(os(), mediaType);
    if (handler && upload.size <= handler.maxBytes)
      Object.assign(share, {
        file: { name: upload.name, mediaType, bytes: new Uint8Array(await upload.arrayBuffer()) },
      });
  }
  if (!share.text && !share.url && !share.file) return redirect('/');
  return redirect(`/?os-share=${held.hold(share)}`);
}
