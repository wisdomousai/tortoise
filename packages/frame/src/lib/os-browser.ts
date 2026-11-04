import { useEffect } from 'react';
import type {
  BlobRef,
  CatalogOs,
  JsonObject,
  OsActionOutcome,
  RawOsRequest,
} from '@tortoise/contracts';
import { fileHandlerFor, fileRequest, launchRequest } from '@tortoise/shell';
import { hostJson } from './host-client';

/** What Chromium hands an installed web app that was opened with files. */
interface LaunchParams {
  readonly files: readonly { getFile(): Promise<File> }[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** Submit one OS request as this page's session; the frame's delivery poll shows the result. */
const submit = (request: RawOsRequest) =>
  hostJson('shell/requests', { platform: 'web', request }).catch(() => undefined);

let declarations: Promise<CatalogOs> | undefined;
const declared = () =>
  (declarations ??= hostJson<CatalogOs>('shell/declarations').catch(() => ({
    handlers: [],
    actions: [],
  })));

/** Stage a blob payload in the blob store as this page's session; refused uploads submit nothing. */
async function upload(bytes: Uint8Array, mediaType: string): Promise<BlobRef | undefined> {
  const response = await fetch('/api/v1/blobs', {
    method: 'POST',
    headers: { 'Content-Type': mediaType },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  return response.status === 201 ? ((await response.json()) as BlobRef) : undefined;
}

/** A launched file is read only when a declared file handler accepts it, within its limit. */
async function submitFile(handle: { getFile(): Promise<File> }) {
  const file = await handle.getFile();
  const handler = fileHandlerFor(await declared(), file.name, file.type || undefined);
  if (!handler || file.size > handler.maxBytes) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const request = await fileRequest(handler, file.name, bytes, upload, file.type || undefined);
  if (request) await submit(request);
}

let launchRequestRead = false;

/**
 * The browser shell adapter, mounted once at the frame root. It takes the link or shortcut a
 * protocol handler or manifest shortcut put in the launch URL (`/?os=…`), removes it from the
 * address so a reload does not submit it again, and consumes the files an installed web app was
 * launched with. Everything is submitted as an ordinary OS request: the host matches it, and an
 * unsolicited request can only open a screen or prefill a form.
 */
export function useBrowserOsInput() {
  useEffect(() => {
    if (!launchRequestRead) {
      launchRequestRead = true;
      const request = launchRequest(window.location.search);
      if (window.location.search)
        history.replaceState(history.state, '', window.location.pathname + window.location.hash);
      if (request) void submit(request);
    }
    const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
    queue?.setConsumer((params) => {
      for (const handle of params.files) void submitFile(handle).catch(() => undefined);
    });
  }, []);
}

/**
 * Ask for a declared OS action from a click handler. An attached adapter (the desktop shell)
 * performs it; otherwise the page runs the instruction itself while it still has the click's
 * user activation: an open in a new browsing context without an opener, a share through the
 * Web Share API. Resolves the host's outcome; a refused action opens nothing.
 */
export async function runOsAction(action: string, params?: JsonObject): Promise<OsActionOutcome> {
  const outcome = await hostJson<OsActionOutcome>('shell/actions', {
    action,
    ...(params ? { params } : {}),
  });
  if (outcome.status !== 'instruction') return outcome;
  const { instruction } = outcome;
  if (instruction.kind === 'open') window.open(instruction.url, '_blank', 'noopener,noreferrer');
  else if (instruction.kind === 'share') {
    if (!navigator.share) throw new Error('This browser cannot share');
    await navigator.share({
      ...(instruction.text ? { text: instruction.text } : {}),
      ...(instruction.url ? { url: instruction.url } : {}),
      ...(instruction.title ? { title: instruction.title } : {}),
    });
  }
  return outcome;
}
