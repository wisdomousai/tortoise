# @agent-native/desktop

The starter's Electron shell. It opens one window on the configured application, and either attaches to the authority already serving the workspace or starts the service as a sidecar and stops it again when that window closes. A packaged build verifies the digests of the service executable and the shipped site policy before launch. `bun run dev` opens the same window against the source service.

Layer: starter (`apps/*`). Owned by whoever forks or scaffolds the starter.

## Primitives

- [Starter](../../docs/primitives.md#starter): the desktop wrapper around `apps/service` and `apps/web`.
- [Shell port](../../docs/primitives.md#shell-port): the Electron calls behind the desktop shell adapter in `@agent-native/shell`.
- [OS handler](../../docs/primitives.md#os-handler): links and files from `open-url`, `open-file`, the command line and a second instance, and the macOS bundle registrations; a blob file is uploaded to the [Blob store](../../docs/primitives.md#blob-store) before it is submitted.
- [OS action](../../docs/primitives.md#os-action): window opens leave only as declared open actions; relayed open, reveal and open-file run here.

[Desktop](../../docs/desktop.md) covers the lifecycle and the native build.

## Entrypoints

This workspace exports nothing; Electron runs it.

| File                                                     | Purpose                                                                                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/main.ts`](src/main.ts)                             | Main process: single-instance lock, runtime verification, service attach or start, the hardened window.                                                                 |
| [`src/service-lifecycle.ts`](src/service-lifecycle.ts)   | `ensureService`: attach first, otherwise start the service and let its workspace lock arbitrate.                                                                        |
| [`src/development-launch.ts`](src/development-launch.ts) | The source launch used by `bun run dev`; honored only when Electron reports the app is unpackaged.                                                                      |
| [`src/os-shell.ts`](src/os-shell.ts)                     | OS links and files (`open-url`, `open-file`, the command line, a second instance), relayed OS actions and window opens, wired to the framework's desktop shell adapter. |
| [`src/preload.ts`](src/preload.ts)                       | Exposes `desktopHost` with the platform name only.                                                                                                                      |
| [`site-policy.json`](site-policy.json)                   | The site policy shipped with the desktop build: `desktop-local` profile, provider endpoints only, fail-closed audit.                                                    |

Package with `bun run package:stage <target>` and `bun run package:desktop <target>`.

## Trust boundary

The renderer is sandboxed with context isolation, no Node integration and web security on; permission requests are denied, webviews are refused, and navigation or redirects away from the authority's origin are blocked. The renderer opens no windows. A URL it asks to open leaves only when a declared OS action builds it, such as the PKCE account-authorization URL of the `openai.authorize` action, and then in the system browser, so provider login never runs inside the app. With the [OS plugin](../../plugins/os/README.md) composed, main performs it as that action, so it is audited and the site can disable it; without the plugin, main rebuilds the URL from the declaration and opens it without an audit record. No IPC transport, provider secret, filesystem or native call crosses the preload bridge; account connection goes through the authenticated local service.

The shell owns only the exact child it launched and stops only that child; closing an attached window leaves an existing authority running. Workspace, port, web root, runtime manifest and site policy are applied after any developer environment, so a launch cannot override them. A packaged process ignores the development flag and keeps the digest checks; changed native bytes, path traversal and links in native packages are refused. `src/service-lifecycle.ts` is a reviewed egress exemption in `scripts/boundary-rules.ts`: it starts the loopback sidecar. `src/os-shell.ts` is the other: it calls the shell API of that sidecar.

OS input is submitted as the connection-file session, the session the window's launch URL signs in, so a link or file reaches this window and no other. Main passes the application's scheme to the sidecar as `AGENT_NATIVE_OS_SCHEME`; an application without the OS plugin ignores it. On Windows main registers the scheme at startup with `--` before the link, because the installer's registration has no separator. A packaged macOS bundle declares the scheme and document types in its `Info.plist` (`package:stage` writes `os-registrations.json`, `package:desktop` reads it); the Linux and Windows `dir` targets register no file types. A file is read once, only after its size is checked against the handler's limit, and checked again after reading. Relayed `reveal` and `open-file` instructions open only a regular file that is not executable and has no extension the OS would run.

## Dependencies

Framework: `@agent-native/host` (`config` and `runtime-manifest`), `@agent-native/shell` and `@agent-native/contracts`. External: `electron`, and `electron-builder` for packaging. It must never import `examples/*`.

## Tests

```sh
bun run test:package
DESKTOP_EXECUTABLE=<packaged executable> bunx playwright test tests/e2e/desktop.pw.ts
```

- `test/development-launch.test.ts`: a packaged app ignores the development flag; source launches keep host-owned paths and per-application instance names.
- `test/packaging.test.ts`: pinned native artifacts, integrity failure on changed bytes, safe extraction, resources and endpoints stay inside their boundary.
- `test/site-policy.test.ts`: the shipped policy binds only provider endpoints.

The native Playwright tests need an already packaged build and skip without `DESKTOP_EXECUTABLE`. Record native results separately in the [implementation status](../../docs/implementation-status.md).
