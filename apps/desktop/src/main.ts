import { app, BrowserWindow, dialog, session } from 'electron';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOsShell } from './os-shell';
import { ensureService, type ServiceHandle } from './service-lifecycle';
import {
  developmentAppName,
  developmentServiceLaunch,
  isDevelopmentDesktop,
} from './development-launch';
import {
  loadRuntimeManifest,
  resourcePath,
  verifyRuntimeFiles,
} from '@agent-native/host/runtime-manifest';
import { readApplicationIdentity } from '@agent-native/host/config';

let service: ServiceHandle | undefined;
let window: BrowserWindow | undefined;
let quitting = false;
const sourceDir = dirname(fileURLToPath(import.meta.url));
const identity = readApplicationIdentity(resolve(sourceDir, 'app.config.json'));
// Source launches are unpackaged. A packaged build ignores the development flag and
// keeps the digest-checked runtime below.
const developmentDesktop = isDevelopmentDesktop(app.isPackaged, process.env);
// Set stable identity before single-instance locking or userData path resolution.
// Each development application gets its own lock so two examples can run together.
app.setName(
  developmentDesktop
    ? developmentAppName(identity.name, process.env.AGENT_NATIVE_APPLICATION)
    : identity.name,
);
// Links and files the OS opens the application with; macOS sends them before `ready`.
const osShell = createOsShell(identity.scheme);
/**
 * Trusted host override supports isolated desktop acceptance and alternate workspaces; renderer
 * input cannot choose arbitrary filesystem paths.
 */
const workspacePath = () =>
  process.env.AGENT_NATIVE_WORKSPACE
    ? resolve(process.env.AGENT_NATIVE_WORKSPACE)
    : resolve(app.getPath('userData'), 'workspace');

/** Attach to or start the instance: from this checkout in development, else the verified runtime. */
async function startService(workspace: string): Promise<ServiceHandle> {
  // Bun runs the service from this checkout. Digest checks stay on the packaged stage.
  if (developmentDesktop)
    return ensureService({
      ...developmentServiceLaunch(process.env, workspace),
      scheme: identity.scheme,
    });
  const resources = app.isPackaged
    ? resolve(process.resourcesPath, 'application')
    : resolve(sourceDir, '../resources');
  const manifest = await loadRuntimeManifest(resources);
  await verifyRuntimeFiles(resources, manifest);
  // The packaged policy (digest-verified above) binds only the provider endpoints. An
  // operator can substitute a site policy through the trusted host environment, as with
  // the workspace; without either the service runs isolated.
  const sitePolicy = process.env.AGENT_NATIVE_SITE_POLICY
    ? resolve(process.env.AGENT_NATIVE_SITE_POLICY)
    : manifest.sitePolicy
      ? resourcePath(resources, manifest.sitePolicy.path)
      : undefined;
  return ensureService({
    workspace,
    executable: resourcePath(resources, manifest.service.executable),
    webRoot: resourcePath(resources, manifest.webRoot),
    runtimeManifest: resolve(resources, 'runtime-manifest.json'),
    scheme: identity.scheme,
    ...(sitePolicy ? { sitePolicy } : {}),
  });
}

function printDevelopmentLaunch(workspace: string, launchUrl: string) {
  const application = process.env.AGENT_NATIVE_APPLICATION ?? identity.name;
  console.log(
    `\n${identity.displayName}: open ${launchUrl}\n` +
      `  The desktop window is this app. The link signs a browser in once and expires after one minute.\n` +
      `  CLI: AGENT_NATIVE_APPLICATION=${application} AGENT_NATIVE_CONNECTION=${resolve(workspace, '.connection.json')} bun run cli list\n`,
  );
}

/** The window's session: no permissions, network only to `origin`, and a strict CSP on its pages. */
function restrictedSession(origin: string) {
  const uiSession = session.fromPartition('application-window');
  uiSession.setPermissionCheckHandler(() => false);
  uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // Renderer egress: network requests may reach only the local instance. CSP says the same
  // for page content; this also covers requests CSP does not govern. Provider sign-in runs in
  // the user's browser (below), so the window itself never contacts the internet.
  uiSession.webRequest.onBeforeRequest((details, callback) => {
    const target = new URL(details.url);
    const network = /^(?:https?|wss?):$/.test(target.protocol);
    callback({ cancel: network && target.origin !== origin });
  });
  uiSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (new URL(details.url).origin === origin) {
      for (const key of Object.keys(headers))
        if (key.toLowerCase() === 'content-security-policy') delete headers[key];
      headers['Content-Security-Policy'] = [
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      ];
    }
    callback({ responseHeaders: headers });
  });
  return uiSession;
}

/** A sandboxed window that cannot navigate, redirect or embed outside `origin`. */
function createWindow(origin: string) {
  const created = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    title: identity.displayName,
    webPreferences: {
      preload: resolve(sourceDir, 'preload.cjs'),
      session: restrictedSession(origin),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  // A new window is never created. A URL that a declared open action builds, such as the
  // provider sign-in, opens in the system browser as that action; anything else is dropped.
  created.webContents.setWindowOpenHandler(({ url }) => {
    osShell.openFromPage(url);
    return { action: 'deny' };
  });
  created.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.once('ready-to-show', () => created.show());
  return created;
}

if (process.platform === 'win32') app.setAppUserModelId(identity.appId);
const showWindow = () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
};
// A second launch hands its parsed links and files to this instance and exits.
if (!app.requestSingleInstanceLock(osShell.handOver)) app.quit();
else {
  app.on('second-instance', (_event, _argv, _directory, handedOver) => {
    osShell.secondInstance(handedOver);
    showWindow();
  });
  app.on('before-quit', (event) => {
    osShell.close();
    if (!quitting && service?.owned) {
      event.preventDefault();
      quitting = true;
      service.stop().finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(async () => {
      const workspace = workspacePath();
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      service = await startService(workspace);
      if (developmentDesktop) printDevelopmentLaunch(workspace, service.launchUrl);
      window = createWindow(service.endpoint);
      // The connection token is the window's session, so OS requests reach this window.
      osShell
        .connect(service.endpoint, service.token, showWindow)
        .catch(() => console.warn('[os] The instance shell API is unreachable'));
      service.child?.once('exit', () => {
        if (!quitting)
          dialog.showErrorBox(
            'Local host stopped',
            'The local workspace service stopped. Close and reopen the application to recover; unfinished agent runs will be marked interrupted.',
          );
      });
      await window.loadURL(service.launchUrl);
    })
    .catch(async (error) => {
      dialog.showErrorBox(
        'Workspace could not start',
        error instanceof Error ? error.message : 'Unknown startup error',
      );
      await service?.stop();
      quitting = true;
      app.quit();
    });
}
