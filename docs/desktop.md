# Desktop host

The Electron window in `apps/desktop` and its packaged build run an application on one person's machine.

## Window and renderer

The desktop is an Electron window around the same loopback instance that browsers, the CLI and MCP clients use. Electron owns the window and the trusted bootstrap. The Bun host owns sessions, authorization, storage, provider credentials and runs. Renderer code has no Node integration, generic IPC, file access or token bridge. Only immutable platform metadata reaches the preload.

The window runs with:

- Context isolation and sandboxing
- Web security and a self-only content security policy
- Every permission denied
- Navigation, redirects and webviews blocked outside the instance's origin
- No new windows

Network requests reach only the local instance. URLs leave only as declared open actions (such as the provider sign-in) in the system browser.

`app.config.json` is the product identity. It sets the web build's title, the application name and ID, the window title, the Windows application model ID and the URL scheme. The scaffold rewrites it for an exported application.

## Instance ownership

The workspace is a canonical path on a local filesystem. A dedicated lock database holds an exclusive OS lock for the host's lifetime, separate from business transactions. A crash releases the lock, and no stale PID or timeout removes a live one. When two windows race to start, the lock decides.

The window first tries to attach:

- Reads the private connection file
- Checks that the endpoint is loopback
- Verifies the contract with the bearer token
- Asks for a one-time launch credential

If attaching fails, Electron launches the compiled host from the runtime manifest and waits for its ready line, then performs the same handshake and loads the bootstrap URL. Secrets go to the host and never through the preload.

An attached host stays owned by the process that started it; closing an attaching window never stops the host. Electron stops a host it started only when the instance file still names that exact instance, so a failed competing launch cannot stop the winner. The default workspace sits under Electron's `userData` directory. Trusted launchers and tests point `TORTOISE_WORKSPACE` elsewhere; the renderer cannot.

## Deployment policy

The build ships `apps/desktop/deployment-policy.json` under the `desktop-local` hardening profile. It binds only the OpenAI and Anthropic provider endpoints and asks for a fail-closed audit log. An application that composes the deployment plugin also needs the network and audit plugins, or startup refuses (`plugins/deployment/src/needs.ts`). `desktop-local` is the only profile that accepts a best-effort audit log ([security and compliance](security-and-compliance.md#hardening-profiles)). `TORTOISE_DEPLOYMENT_POLICY` in the trusted host environment substitutes another policy.

## OS integration

The main process receives OS handler links and files from Electron's open-URL and open-file events, the command line and a second instance's hand-over. The desktop shell adapter in [`packages/shell`](../packages/shell/README.md) submits each one to the shell port as the connection file's session. Because the window's launch URL signs in as that session, the input reaches only this window.

The adapter runs relayed OS actions:

- **Open** — uses the system browser
- **Reveal and open-file** — acts only on a regular file that is not executable and has no runnable extension
- **Share** — opens the share menu on macOS only
- **Notify** — shows an Electron notification with buttons on macOS and Windows

Declared shortcuts become the macOS dock menu and the Windows jump list.

Windows registers the scheme at startup with `--` before the link. A packaged macOS bundle declares the scheme and document types in `Info.plist`, from the `os-registrations.json` that `package:stage` writes.

## Packaged resources

Targets are macOS arm64 and x64, Windows x64 and Linux x64 with glibc. Each stage contains:

- The compiled host and the web assets
- The deployment policy
- Native Codex and Claude distributions
- The credential addon
- A runtime manifest
- The bundled Electron scripts

It needs no developer Bun, Node, Codex or Claude installation. The staging configuration and the lockfile pin the versions.

- **Acquisition.** Native distributions keep adjacent assets and licenses. The distributions come only from the npm registry over HTTPS, at pinned versions, and the stage verifies the registry's integrity hash.
- **Extraction** rejects path traversal, links and device files.
- **The runtime manifest** records relative paths and SHA-256 digests. Startup checks the primary executables and the deployment policy; the offline smoke test checks every file. Digests detect a damaged stage; signing is a separate release step.
- **The credential addon** loads through a generated static require, because Bun cannot follow npm's dynamic platform loader.
- **Provider binaries** stay outside the archive; the host invokes them by absolute path. The native Claude executable brings its own runtime.

## Development

`bun run dev`, from the repository root or an example, opens the window without packaging. The launcher builds the web assets, bundles the main and preload scripts and starts Electron in development mode. Electron starts the host from source in that workspace, or attaches when one already runs there. An example's dev script keeps its fakes alive until the window closes.

A packaged build ignores development mode. The source host inherits the developer's environment, but workspace, port, web root, runtime manifest and deployment policy from Electron take precedence. The desktop deployment policy is the default, so provider sign-in behaves as in a packaged build. Set `TORTOISE_DEPLOYMENT_POLICY` to an empty value to run isolated. `bun run dev:web` serves the browser without a window.

## Build and smoke test

```sh
bun install --frozen-lockfile
bun run build:web
bun run package:stage darwin-arm64 artifacts/desktop/review-darwin-arm64
bun scripts/package-smoke.ts artifacts/desktop/review-darwin-arm64
bun run package:desktop darwin-arm64 artifacts/desktop/review-darwin-arm64
```

Run the smoke test on the target platform. A stage refuses an existing directory — use a new name after changes instead of deleting earlier evidence. Building needs registry access; the packaged application does not.

The smoke test checks every hash and runs each provider with `--version` in a clean environment, starts the compiled host in a fresh workspace, checks the shipped HTML and stops the host. It does not sign in, run inference or use the credential store.

The packaged-window tests take the absolute path of the executable:

```sh
DESKTOP_EXECUTABLE='/absolute/path/to/packaged/executable' bunx playwright test tests/e2e/desktop.pw.ts
```

The packaged-window tests check window isolation, live UI updates, persistence across reopen, shutdown of an owned host and survival of an attached one. Rerun on the final stage after any change.

## Platform gates

Before claiming support for a target, run on that platform:

- the smoke test and the packaged-window tests
- set, get and delete on a disposable credential-store entry, plus locked and denied store behavior
- process-tree cancellation
- instance contention and crash recovery

On Linux, a missing or locked Secret Service leaves credential-free work usable and refuses provider connections. Live ChatGPT enrollment, refresh, revocation and inference are separate opt-in checks ([providers](providers.md)).

## Limits

- Packaging produces an unsigned directory. Signed installers, notarization, updates and release identity are separate work.
- The Linux and Windows `dir` targets register no file types, and Linux gets no desktop actions.

## References

- [`apps/desktop`](../apps/desktop/README.md)
- [Security and compliance](security-and-compliance.md)
- [Implementation status](implementation-status.md#desktop)
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron application packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)
- [Bun standalone executables and native addons](https://bun.com/docs/bundler/executables)
- [SQLite locking](https://www.sqlite.org/lockingv3.html)
- [Native credential adapter](https://github.com/Brooooooklyn/keyring-node)
- [Architecture](architecture.md#instances-and-hosts)
- [add-os-integration](../packages/shell/skills/add-os-integration/SKILL.md)
