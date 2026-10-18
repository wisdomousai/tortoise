# @agent-native/desktop

The starter's Electron window for the configured [application](../../docs/glossary.md#application). It attaches to the [instance](../../docs/glossary.md#instance) already serving the [workspace](../../docs/glossary.md#workspace), or starts `apps/service` as a sidecar and stops it again when the window closes.

## Layer

[starter](../../docs/glossary.md#starter) (`apps/*`). The Electron main process trusts the launcher's environment and the runtime files after their digest check. Renderer input is untrusted.

## Primitives

- [Starter](../../docs/primitives.md#starter): the desktop wrapper around `apps/service` and `apps/web`.
- [Shell port](../../docs/primitives.md#shell-port): the Electron calls behind the desktop shell adapter in `@agent-native/shell`.
- [OS handler](../../docs/primitives.md#os-handler): links and files from `open-url`, `open-file`, the command line and a second instance, and the macOS bundle registrations. A blob file is uploaded to the [blob store](../../docs/primitives.md#blob-store) before it is submitted.
- [OS action](../../docs/primitives.md#os-action): a window open leaves only as a declared open action. Relayed open, reveal and open-file actions run here.

## Entrypoints

This package exports nothing; Electron runs it.

| File | Runs in | Holds |
| --- | --- | --- |
| [`src/main.ts`](src/main.ts) | Electron main | Single-instance lock, runtime verification, instance attach or start, the hardened window. |
| [`src/service-lifecycle.ts`](src/service-lifecycle.ts) | Electron main | `ensureService`: attach first, else start the sidecar and let its workspace lock arbitrate. |
| [`src/development-launch.ts`](src/development-launch.ts) | Electron main | The source launch behind `bun run dev`, honored only when Electron reports an unpackaged build. |
| [`src/os-shell.ts`](src/os-shell.ts) | Electron main | OS input and relayed OS actions, wired to the framework's desktop shell adapter. |
| [`src/preload.ts`](src/preload.ts) | preload | Exposes `desktopHost` with the platform name and a `desktop` flag only. |
| [`site-policy.json`](site-policy.json) | sidecar | The shipped deployment policy: `desktop-local` hardening profile, provider endpoints only, fail-closed audit log. |

`src/os-shell.ts` handles:

- links and files from `open-url`, `open-file`, the command line and a second instance;
- relayed OS actions: a share opens the share menu on macOS, and a notification shows through `Notification` with its buttons on macOS and Windows;
- the declared shortcuts, as the macOS dock menu and the Windows jump list;
- window opens.

`bun run dev` opens the same window against `apps/service` run from source. A packaged build verifies the digests of the compiled [host](../../docs/glossary.md#host) executable and the shipped [deployment policy](../../docs/glossary.md#deployment-policy) before launch. Package a build with:

```sh
bun run package:stage <target>
bun run package:desktop <target>
```

## Trust boundary

The renderer runs sandboxed, with context isolation, no Node integration and web security on. Permission requests are denied and webviews are refused. Navigation and redirects away from the instance's origin are blocked, and the renderer opens no windows. No inter-process communication (IPC) transport, provider secret, filesystem or native call crosses the preload bridge. Account connection goes through the authenticated local instance.

A URL the renderer asks to open leaves only when a declared [OS action](../../docs/glossary.md#os-action) builds it. An example is the PKCE account-authorization URL of the `openai.authorize` action. The URL opens in the system browser, so provider sign-in never runs inside the window. With the `plugins/os` [host plugin](../../docs/glossary.md#host-plugin) composed, main performs the open as that action, so it is audited and the site can disable it. Without the plugin, main rebuilds the URL from the declaration and opens it without an audit record.

Main owns only the exact child it launched and stops only that child. Closing an attached window leaves an existing instance running. Workspace, port, web root, runtime manifest and deployment policy are applied after any developer environment, so a launch cannot override them. A packaged process ignores the development flag and keeps the digest checks. Changed native bytes, path traversal and links in native packages are refused.

`scripts/boundary-rules.ts` lists two reviewed [egress guard](../../docs/glossary.md#egress-guard) exemptions in this package. `src/service-lifecycle.ts` starts the loopback sidecar. `src/os-shell.ts` calls the shell API of that sidecar.

OS input is submitted as the connection-file [session](../../docs/glossary.md#session). The window's launch URL signs in as the same session, so a link or file reaches this window and no other. Main passes the application's scheme to the sidecar as `AGENT_NATIVE_OS_SCHEME`, and an application without the OS plugin ignores it. On Windows, main registers the scheme at startup with `--` before the link, because the installer's registration has no separator.

A packaged macOS bundle declares the scheme and document types in its `Info.plist`. `package:stage` writes `os-registrations.json`, and `package:desktop` reads it. The Linux and Windows `dir` targets register no file types.

A file is read once, after its size is checked against the handler's limit, and its size is checked again after reading. Relayed `reveal` and `open-file` instructions open only a regular file. The file must not be executable and must not have an extension the OS would run.

## Dependencies

Framework: `@agent-native/host` (`config` and `runtime-manifest`), `@agent-native/shell` and `@agent-native/contracts`. External: `electron`, and `electron-builder` for packaging. The package must never import `examples/*`.

## Tests

```sh
bun run test:package
DESKTOP_EXECUTABLE=<packaged executable> bunx playwright test tests/e2e/desktop.pw.ts
```

- `test/development-launch.test.ts`: a packaged build ignores the development flag. Source launches keep host-owned paths and per-application instance names.
- `test/packaging.test.ts`: pinned native artifacts, integrity failure on changed bytes, safe extraction, and resources and endpoints kept inside their boundary.
- `test/site-policy.test.ts`: the shipped policy binds only provider endpoints.

The native Playwright tests need an already packaged build and skip without `DESKTOP_EXECUTABLE`. Record native results separately in the [implementation status](../../docs/implementation-status.md) ledger.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers and actions, and the electron-builder registrations.
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md): the shipped deployment policy and its test.

## References

- [Desktop](../../docs/desktop.md)
