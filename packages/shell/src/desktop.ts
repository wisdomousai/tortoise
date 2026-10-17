import type {
  BlobRef,
  CatalogOs,
  OsActionOutcome,
  OsActionRequest,
  OsActionResult,
  OsInstruction,
  OsPlatform,
  RawOsRequest,
} from '@agent-native/contracts';
import { openActionFor, openUrl } from './actions';
import { pathName, type DesktopArguments } from './desktop-arguments';
import { fileHandlerFor, fileRequest } from './local-files';

/**
 * How a desktop shell reaches its authority, as the session the window also uses. Each call
 * resolves `undefined` when the authority composes no plugin that provides the shell port.
 */
export interface DesktopShellClient {
  declarations(): Promise<CatalogOs | undefined>;
  submit(request: RawOsRequest): Promise<{ status: string } | undefined>;
  perform(request: OsActionRequest): Promise<OsActionOutcome | undefined>;
  /** The next relayed instruction, `null` when the wait ended without one. */
  next(signal: AbortSignal): Promise<{ id: string; instruction: OsInstruction } | null | undefined>;
  answer(id: string, result: OsActionResult): Promise<void>;
  /** Store a blob payload in the blob store; `undefined` when the authority keeps no blobs. */
  upload(bytes: Uint8Array, mediaType: string): Promise<BlobRef | undefined>;
}

/** The OS calls a desktop shell makes. Paths come from the authority, which resolved them. */
export interface DesktopShellDependencies {
  readonly platform: OsPlatform;
  readonly client: DesktopShellClient;
  /** A regular file's bytes when it holds at most `maxBytes`, or `undefined`. */
  readonly readFile: (path: string, maxBytes: number) => Promise<Uint8Array | undefined>;
  /** Open a URL in the system's default handler. */
  readonly open: (url: string) => Promise<void>;
  readonly reveal: (path: string) => Promise<OsActionResult>;
  readonly openFile: (path: string) => Promise<OsActionResult>;
  /** Show the system share menu with text or a URL; absent, share actions are refused. */
  readonly share?: (content: { text?: string; url?: string }) => Promise<OsActionResult>;
  /** Bring the window forward after a request was delivered to it. */
  readonly focus: () => void;
  readonly report?: (message: string) => void;
  /** Delay after a failed poll before the next; the default is one second. */
  readonly retryMs?: number;
}

/** OS input that arrived before the authority was reachable; the oldest is dropped beyond this. */
const bufferLimit = 16;

/** Run one relayed instruction; an open URL is checked against the declarations again. */
async function runInstruction(
  dependencies: DesktopShellDependencies,
  actions: CatalogOs['actions'],
  instruction: OsInstruction,
): Promise<OsActionResult> {
  switch (instruction.kind) {
    case 'open':
      if (openActionFor(actions, instruction.url)?.action !== instruction.action)
        return { ok: false, detail: 'not a declared open action' };
      await dependencies.open(instruction.url);
      return { ok: true };
    case 'reveal':
      return dependencies.reveal(instruction.path);
    case 'open-file':
      return dependencies.openFile(instruction.path);
    case 'share': {
      if (!dependencies.share)
        return { ok: false, detail: 'share is not supported on this desktop' };
      const { text, url } = instruction;
      return dependencies.share({
        ...(text !== undefined ? { text } : {}),
        ...(url !== undefined ? { url } : {}),
      });
    }
    default:
      return { ok: false, detail: `${instruction.kind} is not supported on this desktop` };
  }
}

/** Poll for relayed instructions until stopped or the authority has no shell port. */
async function relay(
  dependencies: DesktopShellDependencies,
  actions: () => CatalogOs['actions'],
  signal: AbortSignal,
) {
  const { client } = dependencies;
  while (!signal.aborted) {
    try {
      const next = await client.next(signal);
      if (next === undefined) return;
      if (next)
        await client.answer(
          next.id,
          await runInstruction(dependencies, actions(), next.instruction).catch(() => ({
            ok: false,
          })),
        );
    } catch {
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, dependencies.retryMs ?? 1_000));
    }
  }
}

/**
 * The desktop shell adapter, independent of Electron: it submits links and files the OS opened
 * the application with (a blob payload uploaded first), performs the actions the authority relays to it, and checks URLs the
 * window asks to open against the declared open actions. Input is buffered until `connect`.
 * The caller supplies the OS calls and the authority client, so this file reaches neither.
 */
export function createDesktopShell(dependencies: DesktopShellDependencies) {
  const { client, report = () => undefined } = dependencies;
  let declarations: CatalogOs | undefined;
  let buffered: DesktopArguments[] = [];
  const stopping = new AbortController();

  async function submit(request: RawOsRequest) {
    const outcome = await client.submit(request);
    if (outcome?.status === 'delivered') dependencies.focus();
    else if (outcome) report(`OS request ${outcome.status}`);
  }
  async function submitFile(os: CatalogOs, path: string) {
    const name = pathName(path);
    const handler = fileHandlerFor(os, name);
    if (!handler) return report('No declared file handler for this file type');
    const bytes = await dependencies.readFile(path, handler.maxBytes);
    const request = bytes && (await fileRequest(handler, name, bytes, client.upload));
    if (!request) return report(`The file does not fit ${handler.id}`);
    await submit(request);
  }
  async function deliver(input: DesktopArguments) {
    if (!declarations) {
      buffered = [...buffered, input].slice(-bufferLimit);
      return;
    }
    for (const url of input.urls) await submit({ kind: 'url', url });
    for (const path of input.paths) await submitFile(declarations, path);
  }

  return {
    /** Links and files from a launch, a second instance or an OS event. */
    receive: (input: DesktopArguments) => deliver(input).catch(() => report('OS request failed')),
    /** Read the declarations, submit buffered input and start performing relayed actions. */
    async connect() {
      declarations = (await client.declarations()) ?? { handlers: [], actions: [] };
      const pending = buffered;
      buffered = [];
      for (const input of pending) await deliver(input);
      void relay(dependencies, () => declarations?.actions ?? [], stopping.signal);
    },
    /**
     * A URL the window asked to open. Only one a declared open action builds is opened, and then
     * as the action, so the shell port audits it, applies the site's disabled list and its rate.
     * An authority without the shell port leaves the check here; the URL is rebuilt from the
     * declaration either way.
     */
    async openFromPage(url: string) {
      const match = openActionFor(declarations?.actions ?? [], url);
      if (!match) return report('The window asked to open an undeclared URL');
      const outcome = await client.perform(match);
      if (outcome?.status === 'refused') return report(`OS action refused: ${outcome.reason}`);
      if (outcome?.status === 'instruction' && outcome.instruction.kind === 'open')
        await dependencies.open(outcome.instruction.url);
      if (outcome === undefined) {
        const action = declarations?.actions.find((item) => item.id === match.action);
        if (action?.kind === 'open') await dependencies.open(openUrl(action.url, match.params));
      }
    },
    /** Stop polling for relayed actions. */
    close: () => stopping.abort(),
  };
}
export type DesktopShell = ReturnType<typeof createDesktopShell>;
