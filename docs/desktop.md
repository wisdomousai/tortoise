# Desktop host

The desktop is an Electron window around the same loopback authority that browsers, the CLI and MCP clients use. Electron owns the window and the trusted bootstrap. The Bun service owns sessions, authorization, storage, provider credentials and runs. Renderer code has no Node integration, generic IPC, file access or token bridge.

The preload exposes only immutable platform metadata. The window runs with context isolation, sandboxing, web security, all permissions denied, external navigation and new windows blocked, and a self-only CSP. The one exception opens the exact ChatGPT authorization endpoint in the system browser; there is no general URL-opening method.

`app.config.json` is the product identity. It sets the page title, the application name and ID, the window title and the Windows application model ID, and the scaffolder rewrites it for an exported application.

## Development

`bun run dev`, from the repository root or an example, opens the window without packaging. The launcher builds the web assets, bundles the main and preload scripts, and starts Electron in development mode. Electron starts the service from source in that workspace, or attaches when an authority is already running there. An example's dev script keeps its fakes alive until the window closes. Closing a window stops the service only if that window started it.

Development mode is ignored in a packaged build. The source service inherits the developer's environment except for the variables the host sets: workspace, port, web root, runtime manifest and site policy. The desktop site policy is the default, so provider sign-in behaves like a packaged build. Set `AGENT_NATIVE_SITE_POLICY` to an empty value to run isolated. `bun run dev:web` serves the browser without a window.

## Who owns the authority

The workspace is a canonical path on a local filesystem. A dedicated lock database holds an exclusive OS lock for the service's lifetime, separate from business transactions. A crash releases the lock, and nothing else, such as a stale PID or a timeout, ever removes a live one. When two frontends race to start, the lock decides which one owns the workspace.

The host first tries to attach. It reads the private connection file, checks that the endpoint is loopback, verifies the contract with its bearer token, and asks for a one-time launch credential. A connection file alone does not prove a service is alive. If attaching fails, Electron launches the compiled service from the runtime manifest, waits for its ready line, performs the same handshake and loads the bootstrap URL. Secrets go to the service and never through the preload.

An attached service stays owned by whoever started it. Closing an attaching window never stops it. An owned service is stopped only if the authority file still names that exact instance, so a failed competing launch cannot stop the winner. The default workspace sits under Electron's user data. Trusted launchers and tests can point `AGENT_NATIVE_WORKSPACE` elsewhere; the renderer cannot. Provider home directories are separate from the developer's own CLI configuration.

## Packaged resources

The targets are macOS arm64 and x64, Windows x64 and Linux x64 with glibc. Each stage contains the compiled service, the web assets, native Codex and Claude distributions, the credential addon, a runtime manifest and the bundled Electron scripts. No developer Bun, Node, Codex or Claude installation is needed. Versions are pinned in the staging configuration and the lockfile.

- **Acquisition.** Native distributions keep their adjacent assets and licenses. They come only from the npm registry over HTTPS, at pinned versions, with the registry's integrity hash verified.
- **Extraction** rejects path traversal, links and device files.
- **The runtime manifest** records relative paths and SHA-256 digests. Startup checks the primary executables, and the offline smoke test checks every asset. Digests detect a damaged stage; signing is a separate release step.
- **The credential addon** is embedded through a static require that the staging script generates, because Bun cannot follow npm's dynamic platform loader.
- **Provider binaries** stay outside the archive and are invoked by absolute path. The native Claude executable brings its own runtime.

## Build and smoke test

```sh
bun install --frozen-lockfile
bun run build:web
bun run package:stage darwin-arm64 artifacts/desktop/review-darwin-arm64
bun scripts/package-smoke.ts artifacts/desktop/review-darwin-arm64
bun run package:desktop darwin-arm64 artifacts/desktop/review-darwin-arm64
```

Run the smoke test on the target platform. A stage refuses an existing directory, so use a new name after changes rather than deleting earlier evidence. Building needs registry access; the packaged application does not.

The smoke test checks every hash, runs each provider with `--version` in a clean environment, starts the compiled service in a fresh workspace, checks the shipped HTML and shuts the service down. It does not sign in, run inference or use the credential store.

The packaged-window tests take the absolute path of the executable:

```sh
DESKTOP_EXECUTABLE='/absolute/path/to/packaged/executable' bunx playwright test tests/e2e/desktop.pw.ts
```

They check the window's isolation, live UI updates, persistence across reopen, shutdown of an owned service and survival of an attached one. Rerun them on the final stage after any change; the executable path identifies the artifact that was checked.

Packaging produces an unsigned directory. Signed installers, notarization, updates and release identity are separate work.

## Platform gates

Before claiming support for a target, run on that platform:

- the smoke test and the packaged-window tests;
- set, get and delete on a disposable credential-store entry, plus locked and denied store behavior;
- process-tree cancellation;
- authority contention and crash recovery.

On Linux, a missing or locked Secret Service leaves credential-free work usable and refuses provider connections. Live ChatGPT enrollment, refresh, revocation and inference are separate opt-in checks ([providers](providers.md)).

## References

- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron application packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)
- [Bun standalone executables and native addons](https://bun.com/docs/bundler/executables)
- [SQLite locking](https://www.sqlite.org/lockingv3.html)
- [Native credential adapter](https://github.com/Brooooooklyn/keyring-node)
