# Desktop host

The desktop host embeds the application's web interface in Electron. Its main process starts a Bun host or attaches to an existing local instance. The renderer reaches that instance over loopback and uses its normal capability interface.

## Window and renderer

Electron owns the window and trusted bootstrap. The Bun host keeps the workspace and authorizes requests. Renderer code has no Node integration or generic IPC. The preload exposes immutable platform metadata and does not carry credentials.

The window enables context isolation and sandboxing. Web security and a self-only content security policy restrict renderer resources. Permission requests are denied. Navigation and redirects outside the instance origin are blocked, as are webviews and new windows. Declared open actions use the system browser.

`app.config.json` supplies the application identity used by the build and desktop registration. It determines the displayed title and application identifiers. The scaffold rewrites this file when exporting an application.

## Instance ownership

The host canonicalizes its local workspace path and acquires an exclusive lock in a dedicated lock database. That lock remains open for the host's lifetime and is separate from record transactions. A crashed process releases its OS lock. PID or elapsed-time checks do not remove a live owner's lock.

The desktop first reads the private connection file and checks that its endpoint is loopback. It verifies the application contract using the connection credential and requests a one-time launch credential. If attachment fails, it starts the host named by the runtime manifest and waits for the host's ready output before attempting the same handshake.

Closing an attached window leaves the independently started host running. Electron stops a host it launched only if the instance file still identifies that host. A competing failed launch therefore cannot stop the process that acquired ownership.

The default workspace is under Electron's `userData` directory. A trusted launcher can set `TORTOISE_WORKSPACE`; renderer code cannot change that path.

## Deployment policy

The packaged policy is `apps/desktop/deployment-policy.json`, using the `desktop-local` profile. It binds the bundled provider destinations and requires a fail-closed audit log. A composed deployment plugin requires its network and audit dependencies; startup refuses an incomplete composition.

`TORTOISE_DEPLOYMENT_POLICY` in the trusted host environment can select another policy. The hardening floor is specified in [Security and compliance](security-and-compliance.md#hardening-profiles).

## OS integration

The main process receives registered OS links and file openings. It also handles requests forwarded by another instance. The desktop shell adapter submits these through the shell port using the connection session, matching the window's launch session.

Declared open actions use the system browser. Reveal and open-file actions require a regular file with no executable or runnable extension. Share uses the macOS share menu. Notifications can include buttons on macOS and Windows. Declared shortcuts become dock-menu entries on macOS or jump-list entries on Windows.

Windows registers its URL scheme with a command separator before the incoming link. Packaged macOS builds declare their scheme and document types in `Info.plist`, derived from `os-registrations.json` produced by staging. The [shell package](../packages/shell/README.md) defines the declarations and validation.

## Packaged resources

The staging targets are macOS arm64 and x64, Windows x64, and Linux x64 with glibc. A stage includes its compiled host and web assets alongside its policy and runtime manifest. Bundled provider executables keep their required assets and licenses. The credential addon is staged for the target platform.

Staging downloads pinned distributions over HTTPS and checks registry integrity hashes. Extraction refuses traversal paths and unsupported file kinds. The runtime manifest records relative paths and SHA-256 digests. Startup verifies the primary executables and policy; the smoke test checks all staged files. Release signing remains a separate step.

Provider executables stay outside the archive and are invoked by absolute path. The credential addon is loaded through a generated static require because its npm loader resolves native platforms dynamically. The packaged host requires no developer Bun installation.

## Development

Run `bun run dev` from the repository root to build the web assets and Electron bootstrap. Electron opens a source host or attaches to the instance already serving the workspace. `bun run dev:web` starts the browser interface without Electron.

The source host inherits the developer's environment, with Electron's workspace and bootstrap settings taking precedence. Development uses the desktop policy by default. An empty `TORTOISE_DEPLOYMENT_POLICY` selects isolated development. Packaged builds ignore the development-mode flag.

## Build and smoke test

From the repository root, stage for the required platform in a new directory:

```sh
bun install --frozen-lockfile
bun run build:web
bun run package:stage darwin-arm64 artifacts/desktop/review-darwin-arm64
bun scripts/package-smoke.ts artifacts/desktop/review-darwin-arm64
bun run package:desktop darwin-arm64 artifacts/desktop/review-darwin-arm64
```

The stage command refuses an existing destination. Building needs registry access; execution of the staged host uses the bundled resources. Run smoke verification on the target platform.

Smoke verification checks file hashes and provider version commands in a clean environment. It starts the compiled host on a fresh workspace, checks the shipped HTML and shuts the host down. It does not exercise provider sign-in or inference. Credential-store behavior also requires separate execution.

The packaged-window suite takes an absolute executable path:

```sh
DESKTOP_EXECUTABLE='/absolute/path/to/packaged/executable' bunx playwright test tests/e2e/desktop.pw.ts
```

The suite checks isolation and record persistence through the real window. It exercises ownership during reopen and shutdown. Rerun against the final stage after changes.

## Platform gates

Platform support requires a smoke run and packaged-window run on that target. Exercise a disposable credential entry, including unavailable or locked-store responses. Process-tree cancellation and workspace contention also require platform evidence.

A missing or locked Linux Secret Service leaves credential-free application work available but refuses provider connections. Live provider enrollment and inference require explicit configuration, as specified in [Agents](agents.md#evaluation).

## Limits

Packaging currently produces an unsigned directory. Installer signing and notarization require release work. The Linux and Windows directory targets register no file types; Linux has no desktop actions. Dated runs and remaining platform gaps are recorded in [Implementation status](implementation-status.md#desktop).
