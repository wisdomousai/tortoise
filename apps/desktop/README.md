# @agent-native/desktop

The starter's Electron shell. It opens one window on the configured application, and either attaches to the authority already serving the workspace or starts the service as a sidecar and stops it again when that window closes. A packaged build verifies the digests of the service executable and the shipped site policy before launch. `bun run dev` opens the same window against the source service.

Layer: starter (`apps/*`). Owned by whoever forks or scaffolds the starter.

## Primitives

- [Starter](../../docs/primitives.md#starter): the desktop wrapper around `apps/service` and `apps/web`.

[Desktop](../../docs/desktop.md) covers the lifecycle and the native build.

## Entrypoints

This workspace exports nothing; Electron runs it.

| File                                                     | Purpose                                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`src/main.ts`](src/main.ts)                             | Main process: single-instance lock, runtime verification, service attach or start, the hardened window.              |
| [`src/service-lifecycle.ts`](src/service-lifecycle.ts)   | `ensureService`: attach first, otherwise start the service and let its workspace lock arbitrate.                     |
| [`src/development-launch.ts`](src/development-launch.ts) | The source launch used by `bun run dev`; honored only when Electron reports the app is unpackaged.                   |
| [`src/preload.ts`](src/preload.ts)                       | Exposes `desktopHost` with the platform name only.                                                                   |
| [`site-policy.json`](site-policy.json)                   | The site policy shipped with the desktop build: `desktop-local` profile, provider endpoints only, fail-closed audit. |

Package with `bun run package:stage <target>` and `bun run package:desktop <target>`.

## Trust boundary

The renderer is sandboxed with context isolation, no Node integration and web security on; permission requests are denied, webviews are refused, and navigation or redirects away from the authority's origin are blocked. The renderer opens no windows; the one link allowed to leave it is the PKCE account-authorization URL, which opens in the system browser so provider login never runs inside the app. No IPC transport, provider secret, filesystem or native call crosses the preload bridge; account connection goes through the authenticated local service.

The shell owns only the exact child it launched and stops only that child; closing an attached window leaves an existing authority running. Workspace, port, web root, runtime manifest and site policy are applied after any developer environment, so a launch cannot override them. A packaged process ignores the development flag and keeps the digest checks; changed native bytes, path traversal and links in native packages are refused. `src/service-lifecycle.ts` is a reviewed egress exemption in `scripts/boundary-rules.ts`: it starts the loopback sidecar.

## Dependencies

Framework: `@agent-native/host` (`config` and `runtime-manifest`). External: `electron`, and `electron-builder` for packaging. It must never import `examples/*` ([P11](../../docs/principles.md#p11--layers-depend-inward-and-an-authority-runs-one-application)).

## Tests

```sh
bun run test:package
DESKTOP_EXECUTABLE=<packaged executable> bunx playwright test tests/e2e/desktop.pw.ts
```

- `test/development-launch.test.ts`: a packaged app ignores the development flag; source launches keep host-owned paths and per-application instance names.
- `test/packaging.test.ts`: pinned native artifacts, integrity failure on changed bytes, safe extraction, resources and endpoints stay inside their boundary.
- `test/site-policy.test.ts`: the shipped policy binds only provider endpoints.

The native Playwright tests need an already packaged build and skip without `DESKTOP_EXECUTABLE`. Record native results separately in the [implementation status](../../docs/implementation-status.md).
