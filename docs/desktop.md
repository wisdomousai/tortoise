# Desktop host and standalone packaging

The desktop is an Electron window around the same loopback authority used by a browser, CLI and MCP clients. Electron owns window lifecycle and trusted bootstrap. The Bun service owns sessions, authorization, SQLite, provider credentials and agent runs. Renderer code has no Node integration, generic IPC, filesystem interface or bearer token bridge.

Read `apps/desktop/src/main.ts`, `service-lifecycle.ts` and `runtime-manifest.ts` before changing this boundary. The preload exposes only immutable platform/desktop metadata. The window uses context isolation, sandboxing, web security, denied permissions, blocked external navigation and window creation, and a restrictive self-only CSP. Its one external-navigation exception opens the exact ChatGPT HTTPS authorization endpoint in the system browser with code/S256 parameters; it does not expose a general URL-opening IPC method.

`app.config.json` is the shared product identity. The browser build escapes its display name into the page title, staging copies the configuration beside desktop main/preload, and packaging uses that staged app ID and display name. Electron sets the application name before single-instance locking and resolving userData, uses the configured window title, and sets the Windows application model ID. The scaffolder rewrites this configuration for the exported application.

## Development launch

`bun run dev` from the repository root, or from an example directory, opens this window without a packaged stage. The launcher builds the web assets, bundles the Electron main and preload into `dist/desktop`, and starts Electron with `AGENT_NATIVE_DESKTOP_DEV=1`. Electron then starts the Bun service from source (`apps/service/src/index.ts`) in the example or repository workspace, or attaches when that workspace already has an authority. An example's `dev.ts` still runs in the launcher, so the line-station fake HMI stays up until the window closes. Closing a window that started the service stops it; closing one that only attached does not.

The development flag is ignored when the app is packaged. Packaged startup still loads the runtime manifest and verifies resource digests. The source service inherits the developer environment of the launch, except Electron control variables and the workspace, port, web root, runtime manifest and site policy, which the host sets. The desktop site policy (`apps/desktop/site-policy.json`) is the default so provider sign-in matches a packaged build; set `AGENT_NATIVE_SITE_POLICY` empty to run isolated. `bun run dev:web` serves the browser and does not open the window.

## Authority ownership

The service workspace is canonicalized and must reside on a local filesystem. Its dedicated authority-lock SQLite database holds an OS-backed exclusive transaction for the service lifetime, separate from business transactions. Crash exit releases the OS lock. A PID, timeout or stale descriptor never authorizes deleting a live lock. Two frontends may race to start; the service lock decides which authority owns the workspace.

The trusted host first reads private `.connection.json`, validates a plain loopback endpoint, verifies `/api/v1/contract` with its bearer and requests a one-use `/api/v1/launch` credential. A descriptor alone is not proof that a service is alive. If attach fails, Electron launches the manifest's compiled service with `PORT=0`, an absolute `WORKSPACE_PATH`, `WEB_ROOT` and `AGENT_RUNTIME_MANIFEST`. The bounded ready line includes the owner instance ID. Electron then performs the same authenticated handshake and loads the fragment bootstrap URL. Secrets are consumed by the service rather than exposed by preload.

An attached service remains owned by its original host. Closing an attaching desktop never kills it. An owned child receives authenticated shutdown only if `.authority.json` still matches that child's ready instance, followed by bounded process termination if necessary. A failed competing launch cannot shut down the winning authority through their shared descriptor. Startup failure closes only the child started by this host.

The default workspace is Electron's userData/workspace. Trusted launchers and acceptance tests may set `AGENT_NATIVE_WORKSPACE` to an isolated absolute path. This host-only override is unavailable to the renderer. Provider homes are separate from the user's developer CLI homes, and provider credentials require explicit account/key actions.

## Packaged resources

The selected targets are macOS arm64, macOS x64, Windows x64 and Linux x64 with glibc. Linux arm64, musl and Windows arm64 are outside the current matrix. Each stage contains a compiled Bun service, built web assets, native Codex/Claude distributions, the target credential addon, a runtime manifest and bundled Electron main/preload JavaScript. The Electron application needs no developer Bun, Node, Codex or Claude installation on PATH.

| Asset            | Pinned version / selection                        | Location and use                                             |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Bun authority    | Repository Bun 1.4.0 build                        | Compiled per target, outside ASAR                            |
| Codex            | `@openai/codex@0.160.1-<target>`                  | Full native npm distribution, absolute executable path       |
| Claude           | `@anthropic-ai/claude-agent-sdk-<target>@0.3.292` | Full native distribution; SDK JS compiled into service       |
| Credential addon | `@napi-rs/keyring-<platform>@2.1.0`               | Direct static `.node` require embedded into compiled service |
| Electron         | 44.6.0                                            | Main/preload in ASAR; application resources outside ASAR     |

The full native distributions retain adjacent assets and licenses rather than copying only an executable. Acquisition is restricted to npm's registry HTTPS origin, pinned identities/versions and verified SHA-512 registry integrity. Extraction rejects traversal, symlinks, hard links and device files. Runtime manifests contain relative paths and SHA-256 digests; startup checks primary executable bytes and the offline smoke checks every provider asset. Digests detect damaged staging; platform signing is a separate release requirement.

Bun's native addon embedding requires a statically visible direct require. The staging script generates an entry that installs that binding before importing the service. Do not replace it with an unresolved dynamic npm platform loader. Provider binaries and their assets are real resources outside ASAR, invoked through absolute paths. The native Claude executable supplies its own runtime; no separate Node sidecar is bundled.

## Build and offline platform smoke

Install the pinned checkout dependencies and build the browser assets first:

```sh
bun install --frozen-lockfile
bun run build:web
bun run typecheck
bun test packages/agents/test apps/desktop/test
bun run package:stage darwin-arm64 artifacts/desktop/review-darwin-arm64
bun scripts/package-smoke.ts artifacts/desktop/review-darwin-arm64
bun run package:desktop darwin-arm64 artifacts/desktop/review-darwin-arm64
```

Replace the target with `darwin-x64`, `win32-x64` or `linux-x64` and run smoke on that OS/architecture. The optional stage path also feeds packaging; omitting it uses artifacts/desktop/<target>. A stage refuses an existing destination, protecting prior and in-flight artifacts. Choose a new stage name after source changes instead of deleting prior evidence. Building downloads pinned native distributions and Electron artifacts, so it needs registry/network access. End-user startup uses shipped assets.

`package-smoke.ts` checks all declared hashes, launches each real native provider with `--version` under a clean environment without developer PATH, starts the compiled service in a fresh temporary workspace, verifies shipped HTML and shuts down its owned service. It does not sign in, invoke inference or exercise the OS credential store. Browser/Playwright acceptance additionally verifies application interactions. Desktop acceptance should launch the actual packaged application with `AGENT_NATIVE_WORKSPACE` set to a fresh test directory and verify isolation, same-origin UI bootstrap, mutation visibility and shutdown/attach ownership.

Run the actual packaged-window tests with its absolute executable path:

```sh
DESKTOP_EXECUTABLE='/absolute/path/to/packaged/executable' bunx playwright test tests/e2e/desktop.pw.ts
```

Those tests create isolated workspaces and a minimal launch PATH. They check window sandbox/context isolation/no Node integration, UI changes and external HTTP updates, persisted reopen, owned-sidecar shutdown and survival of an attached existing service. An earlier macOS arm64 stage passed these two tests in this checkout. Run them again for the final stage after any source change; the executable path identifies the artifact actually checked.

The packaging command currently produces an unsigned directory application. It does not produce signed installers, notarization, an update channel or a public release. Release work must assign a stable app ID/product identity, retain applicable notices, sign nested native assets and the application in the platform's required order, and verify clean installation on each selected OS.

## Remaining platform gates

macOS arm64 staging and unsigned directory packaging have been exercised in this checkout. Cross-target artifact descriptions and deterministic path/integrity tests do not prove those artifacts run on their target OS. Before claiming support for any target, run the compiled-service/native-version smoke and actual packaged-window acceptance there, then test OS-store set/get/delete using a disposable non-production entry, locked/denied-store behavior, process-tree cancellation and authority contention/crash recovery. Linux needs a desktop D-Bus/Secret Service session; an unavailable or locked store must leave the application usable for credential-free work while refusing provider connection.

Live ChatGPT enrollment, token refresh/revocation and provider inference remain separate opt-in gates. Their local signed-token and fake-protocol fixtures prove validation behavior, not provider acceptance. See [provider verification](providers.md) for exact boundaries and the synthetic live probe.

## Primary references

- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron application packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)
- [Bun standalone executables and native addons](https://bun.com/docs/bundler/executables)
- [SQLite locking](https://www.sqlite.org/lockingv3.html)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [Native credential adapter](https://github.com/Brooooooklyn/keyring-node)
