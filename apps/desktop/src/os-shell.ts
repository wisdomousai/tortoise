import { app, shell, ShareMenu } from 'electron';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OsActionResult, OsPlatform } from '@agent-native/contracts';
import {
  createDesktopShell,
  desktopArguments,
  pathName,
  receivedArguments,
  type DesktopArguments,
  type DesktopShellClient,
} from '@agent-native/shell';

const platform: OsPlatform =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';

/**
 * The authority's shell API over loopback, as the connection-file session. The window's launch
 * cookie carries the same session, so a request submitted here is delivered to that window.
 * 503 means the application composes no shell port; 204 ends a relay wait without work.
 */
function authorityClient(endpoint: string, token: string): DesktopShellClient {
  async function call(path: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(`${endpoint}/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([AbortSignal.timeout(35_000), ...(signal ? [signal] : [])]),
      redirect: 'error',
    });
    if (response.status === 503) return undefined;
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Shell API answered ${response.status}`);
    return response.json();
  }
  return {
    declarations: () => call('shell/declarations'),
    submit: (request) => call('shell/requests', { platform, request }),
    perform: (request) => call('shell/actions', request),
    next: (signal) => call(`shell/actions?platform=${platform}`, undefined, signal),
    answer: async (id, result) => void (await call(`shell/actions/${id}/result`, result)),
    // A refused upload (no blob store, or no operation this session may invoke accepts it)
    // leaves the file unsubmitted; the shell reports it.
    async upload(bytes, mediaType) {
      const response = await fetch(`${endpoint}/api/v1/blobs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mediaType },
        body: bytes as Uint8Array<ArrayBuffer>,
        signal: AbortSignal.timeout(120_000),
        redirect: 'error',
      });
      return response.status === 201 ? response.json() : undefined;
    },
  };
}

/**
 * A regular file read once, after its size is checked against `maxBytes`, and checked again
 * after reading in case it grew; anything else is `undefined`.
 */
async function readBytes(path: string, maxBytes: number): Promise<Uint8Array | undefined> {
  try {
    const real = await realpath(path);
    const info = await lstat(real);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    const bytes = await readFile(real);
    return bytes.byteLength > maxBytes ? undefined : bytes;
  } catch {
    return undefined;
  }
}

/** Extensions the OS runs rather than shows; opening one would execute it. */
const runnable =
  /\.(?:app|bat|cmd|com|command|cpl|desktop|exe|hta|jar|js|jse|lnk|msi|pif|ps1|scr|sh|terminal|url|vbs|wsf|workflow)$/i;

/** A regular, non-executable file the authority resolved below its root. */
async function existingFile(path: string): Promise<string | undefined> {
  try {
    const real = await realpath(path);
    const info = await lstat(real);
    if (!info.isFile() || runnable.test(pathName(real))) return undefined;
    if (process.platform !== 'win32' && (info.mode & 0o111) !== 0) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

const refused = (detail: string): OsActionResult => ({ ok: false, detail });

/**
 * The Electron side of the OS integration: link and file events, the launch command line, the
 * second-instance hand-over and the relayed actions, wired to the framework's desktop shell.
 * Register it before `ready`, because macOS delivers the launching link or file before that.
 */
export function createOsShell(scheme: string) {
  const skip = process.defaultApp ? 2 : 1;
  const launch = desktopArguments(process.argv, scheme, skip);
  let desktop: ReturnType<typeof createDesktopShell> | undefined;
  let early: DesktopArguments[] = [launch];
  const receive = (input: DesktopArguments) => {
    if (!input.urls.length && !input.paths.length) return;
    if (desktop) void desktop.receive(input);
    else early = [...early, input].slice(-16);
  };

  app.on('open-url', (event, url) => {
    event.preventDefault();
    receive(desktopArguments(['--', url], scheme, 0));
  });
  app.on('open-file', (event, path) => {
    event.preventDefault();
    receive(desktopArguments(['--', path], scheme, 0));
  });
  // Windows passes links on the command line. The registration puts `--` before the link, so
  // a link that breaks out of its quotes cannot add a switch the parser reads.
  if (process.platform === 'win32')
    app.setAsDefaultProtocolClient(
      scheme,
      process.execPath,
      process.defaultApp ? [resolve(process.argv[1] ?? '.'), '--'] : ['--'],
    );

  return {
    /** What a second instance hands the running one: its own parsed command line. */
    handOver: { urls: launch.urls, paths: launch.paths },
    /** The data a second instance handed over; untrusted, so it is parsed again. */
    secondInstance: (data: unknown) => receive(receivedArguments(data, scheme)),
    /** Connect to the authority once it runs and the window exists. */
    async connect(endpoint: string, token: string, onDelivered: () => void) {
      desktop = createDesktopShell({
        platform,
        client: authorityClient(endpoint, token),
        readFile: readBytes,
        open: (url) => shell.openExternal(url),
        reveal: async (path) => {
          const real = await existingFile(path);
          if (!real) return refused('not a regular file');
          shell.showItemInFolder(real);
          return { ok: true };
        },
        openFile: async (path) => {
          const real = await existingFile(path);
          if (!real) return refused('not a regular, non-executable file');
          const error = await shell.openPath(real);
          return error ? refused(error.slice(0, 200)) : { ok: true };
        },
        // The share menu exists on macOS only; elsewhere a share action is refused.
        ...(process.platform === 'darwin'
          ? {
              share: async ({ text, url }: { text?: string; url?: string }) => {
                new ShareMenu({
                  ...(text !== undefined ? { texts: [text] } : {}),
                  ...(url !== undefined ? { urls: [url] } : {}),
                }).popup();
                return { ok: true };
              },
            }
          : {}),
        focus: onDelivered,
        report: (message) => console.warn(`[os] ${message}`),
      });
      for (const input of early) void desktop.receive(input);
      early = [];
      await desktop.connect();
    },
    /** A URL the window asked to open; only a declared open action is opened. */
    openFromPage: (url: string) => void desktop?.openFromPage(url),
    close: () => desktop?.close(),
  };
}
