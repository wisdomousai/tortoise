import type {
  CatalogOs,
  OsActionResult,
  OsDelivery,
  OsInstruction,
  OsRequestOutcome,
  RawOsRequest,
} from '@agent-native/contracts';
import { openActionFor } from './actions';
import { fileHandlerFor, fileRequest, type BlobUpload } from './local-files';
import { maxSharedItems, shareFileRequest, shareHandlerFor } from './shares';

/** What the OS reports about a file it handed the app: a display name, a size, a media type. */
export interface MobileFileInfo {
  readonly name: string;
  readonly size: number;
  readonly mediaType?: string;
}

/** One item another app shared through the share sheet. A file is read only through `read`. */
export type MobileShare =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'file'; readonly uri: string; readonly mediaType?: string };

/** The OS calls and the in-process authority a mobile shell uses. */
export interface MobileShellDependencies {
  readonly platform: 'android' | 'ios';
  /** The application's URL scheme; links in any other scheme except `https` are ignored. */
  readonly scheme: string;
  readonly declarations: () => CatalogOs;
  /** A file URI the OS opened the app with; `undefined` when it cannot be read. */
  readonly inspect: (uri: string) => Promise<MobileFileInfo | undefined>;
  /** The file's bytes when it holds at most `maxBytes`, or `undefined`. */
  readonly read: (uri: string, maxBytes: number) => Promise<Uint8Array | undefined>;
  readonly upload: BlobUpload;
  /** Submit to the shell port as the device's owner. */
  readonly submit: (request: RawOsRequest) => Promise<OsRequestOutcome>;
  /** Show an accepted request: open, navigate or prefill. */
  readonly deliver: (delivery: OsDelivery) => void;
  /** Open a URL in the system's handler for it. */
  readonly open: (url: string) => Promise<void>;
  /**
   * The items a URI announces another app shared, or `undefined` when the URI is not a share.
   * Each share is taken once; absent, the app receives no shares.
   */
  readonly shared?: (uri: string) => Promise<readonly MobileShare[] | undefined>;
  /** Show the system share sheet with text or a URL; absent, share actions are refused. */
  readonly share?: (content: { text?: string; url?: string; title?: string }) => Promise<void>;
  readonly report?: (message: string) => void;
}

/** Longest URI the OS may hand over, as for desktop links. */
const maxUri = 2048;

/**
 * What a URI the OS opened the app with is: a link in the application's scheme or `https` (a
 * verified link), a file (`content:` on Android, `file:` on iOS), or nothing the app accepts.
 * Syntax only; the shell port matches links against the declared handlers.
 */
export function mobileInput(
  uri: string,
  scheme: string,
): { kind: 'url'; url: string } | { kind: 'file'; uri: string } | undefined {
  if (uri.length > maxUri) return undefined;
  const colon = uri.indexOf(':');
  if (colon < 1) return undefined;
  const protocol = uri.slice(0, colon).toLowerCase();
  if (protocol === 'content' || protocol === 'file') return { kind: 'file', uri };
  if (protocol === scheme || protocol === 'https') return { kind: 'url', url: uri };
  return undefined;
}

/**
 * The mobile shell adapter, independent of React Native: it submits the links and files the OS
 * opened the app with to the in-process shell port, shows what was delivered, and performs the
 * actions the port hands it. A file is inspected first and read only when a declared file
 * handler accepts its name or media type within its `maxBytes`; a blob payload is uploaded to
 * the blob store before the request is submitted.
 */
export function createMobileShell(dependencies: MobileShellDependencies) {
  const { report = () => undefined } = dependencies;

  async function submit(request: RawOsRequest) {
    const outcome = await dependencies.submit(request);
    if (outcome.status === 'delivered') dependencies.deliver(outcome.delivery);
    else if (outcome.status === 'refused') report(`OS request refused: ${outcome.reason}`);
  }
  async function submitFile(uri: string) {
    const info = await dependencies.inspect(uri);
    if (!info) return report('The opened file cannot be read');
    const handler = fileHandlerFor(dependencies.declarations(), info.name, info.mediaType);
    if (!handler) return report('No declared file handler for this file type');
    if (info.size > handler.maxBytes) return report(`The file does not fit ${handler.id}`);
    const bytes = await dependencies.read(uri, handler.maxBytes);
    const request =
      bytes && (await fileRequest(handler, info.name, bytes, dependencies.upload, info.mediaType));
    if (!request) return report(`The file does not fit ${handler.id}`);
    await submit(request);
  }
  async function submitShared(item: MobileShare) {
    if (item.kind === 'text') return submit({ kind: 'share', text: item.text });
    if (item.kind === 'url') return submit({ kind: 'share', url: item.url });
    const info = await dependencies.inspect(item.uri);
    if (!info) return report('The shared file cannot be read');
    const mediaType = info.mediaType ?? item.mediaType;
    const handler = shareHandlerFor(dependencies.declarations(), mediaType);
    if (!handler || !mediaType) return report('No declared share handler for this file type');
    if (info.size > handler.maxBytes) return report(`The file does not fit ${handler.id}`);
    const bytes = await dependencies.read(item.uri, handler.maxBytes);
    const request =
      bytes && (await shareFileRequest(handler, info.name, mediaType, bytes, dependencies.upload));
    if (!request) return report(`The file does not fit ${handler.id}`);
    await submit(request);
  }

  return {
    platform: dependencies.platform,
    /** A URI from the launch or a later OS event. Never rejects. */
    async receive(uri: string) {
      try {
        const shared = await dependencies.shared?.(uri);
        if (shared) {
          for (const item of shared.slice(0, maxSharedItems)) await submitShared(item);
          return;
        }
        const input = mobileInput(uri, dependencies.scheme);
        if (input?.kind === 'url') await submit({ kind: 'url', url: input.url });
        else if (input?.kind === 'file') await submitFile(input.uri);
      } catch {
        report('OS request failed');
      }
    },
    /**
     * Perform an instruction the shell port built. An open is checked against the declared open
     * actions again before the OS sees it, and a share shows the system share sheet with what
     * the declaration allowed; reveal and open-file have no meaning on a phone.
     */
    async perform(instruction: OsInstruction): Promise<OsActionResult> {
      if (instruction.kind === 'share' && dependencies.share) {
        const { text, url, title } = instruction;
        await dependencies.share({
          ...(text !== undefined ? { text } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(title !== undefined ? { title } : {}),
        });
        return { ok: true };
      }
      if (instruction.kind !== 'open')
        return { ok: false, detail: `${instruction.kind} is not supported on this device` };
      if (
        openActionFor(dependencies.declarations().actions, instruction.url)?.action !==
        instruction.action
      )
        return { ok: false, detail: 'not a declared open action' };
      await dependencies.open(instruction.url);
      return { ok: true };
    },
  };
}
export type MobileShell = ReturnType<typeof createMobileShell>;
