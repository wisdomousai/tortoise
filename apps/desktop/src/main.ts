import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
if (process.platform === 'win32') app.setAppUserModelId(identity.appId);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app.on('before-quit', (event) => {
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
      // Trusted host override supports isolated desktop acceptance and alternate
      // workspaces; renderer input cannot choose arbitrary filesystem paths.
      const workspace = process.env.AGENT_NATIVE_WORKSPACE
        ? resolve(process.env.AGENT_NATIVE_WORKSPACE)
        : resolve(app.getPath('userData'), 'workspace');
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      if (developmentDesktop) {
        // Bun runs the service from this checkout. Digest checks stay on the packaged stage.
        service = await ensureService(developmentServiceLaunch(process.env, workspace));
      } else {
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
        service = await ensureService({
          workspace,
          executable: resourcePath(resources, manifest.service.executable),
          webRoot: resourcePath(resources, manifest.webRoot),
          runtimeManifest: resolve(resources, 'runtime-manifest.json'),
          ...(sitePolicy ? { sitePolicy } : {}),
        });
      }
      if (developmentDesktop) {
        const application = process.env.AGENT_NATIVE_APPLICATION ?? identity.name;
        console.log(
          `\n${identity.displayName}: open ${service.launchUrl}\n` +
            `  The desktop window is this app. The link signs a browser in once and expires after one minute.\n` +
            `  CLI: AGENT_NATIVE_APPLICATION=${application} AGENT_NATIVE_CONNECTION=${resolve(workspace, '.connection.json')} bun run cli list\n`,
        );
      }
      const origin = service.endpoint;
      const uiSession = session.fromPartition('application-window');
      uiSession.setPermissionCheckHandler(() => false);
      uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      // Renderer egress: network requests may reach only the local authority. CSP says the same
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
      window = new BrowserWindow({
        width: 1180,
        height: 820,
        show: false,
        title: identity.displayName,
        webPreferences: {
          preload: resolve(sourceDir, 'preload.cjs'),
          session: uiSession,
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
      window.webContents.setWindowOpenHandler(({ url }) => {
        // Only the explicit account-connect link can leave the renderer. OAuth runs
        // in the user's browser; the desktop never embeds provider login pages.
        try {
          const target = new URL(url);
          if (
            target.protocol === 'https:' &&
            target.host === 'auth.openai.com' &&
            target.pathname === '/api/accounts/authorize' &&
            !target.username &&
            !target.password &&
            !target.hash &&
            target.searchParams.get('response_type') === 'code' &&
            target.searchParams.get('code_challenge_method') === 'S256'
          ) {
            void shell.openExternal(target.toString());
          }
        } catch {
          /* malformed external navigation is denied */
        }
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      window.webContents.on('will-redirect', (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.once('ready-to-show', () => window?.show());
      service.child?.once('exit', () => {
        if (!quitting)
          dialog.showErrorBox(
            'Local authority stopped',
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
