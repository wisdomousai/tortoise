import { useEffect } from 'react';
import type { CatalogOs, JsonObject, OsActionOutcome, RawOsRequest } from '@agent-native/contracts';
import { landingRequest, strictText, textFileHandler } from '@agent-native/shell';
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

/** A launched file is read only when a declared text file handler accepts it, within its limit. */
async function submitFile(handle: { getFile(): Promise<File> }) {
  const file = await handle.getFile();
  const handler = textFileHandler(await declared(), file.name);
  if (!handler || file.size > handler.maxBytes) return;
  const text = strictText(await file.arrayBuffer());
  if (text !== undefined) await submit({ kind: 'file', name: file.name, text });
}

let landingTaken = false;

/**
 * The browser shell adapter, mounted once at the frame root. It takes the link or shortcut a
 * protocol handler or manifest shortcut put in the landing URL (`/?os=…`), removes it from the
 * address so a reload does not submit it again, and consumes the files an installed web app was
 * launched with. Everything is submitted as an ordinary OS request: the host matches it, and an
 * unsolicited request can only open a screen or prefill a form.
 */
export function useBrowserOsInput() {
  useEffect(() => {
    if (!landingTaken) {
      landingTaken = true;
      const request = landingRequest(window.location.search);
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
