# @agent-native/frame

The domain-neutral browser shell around one application's screens. The frame supplies the launch exchange and session, hash routing, navigation, the capability palette, the agent run panel, accounts and the security screen, and fills them from the `screens` entrypoint of the configured application. Its Vite plugin binds that entrypoint to a virtual module, so the starter's source never names content. The same parts ship as a shadcn registry, so a starter can copy and own any of them.

Layer: framework (`packages/*`). Browser code, plus a build-time Vite plugin.

## Primitives

- [Web frame](../../docs/primitives.md#web-frame): `Frame`, `ScreensProvider`, `useScreens`, `screenForCapability`, `exchangeLaunch`, and the `frame` Vite plugin.
- [Application](../../docs/primitives.md#application): `defineScreens`, `ApplicationScreens`, the browser entrypoint of every application.
- [UI registry](../../docs/primitives.md#ui-registry): the `agent-native` shadcn registry in [`registry.json`](registry.json) (`capability-form`, `live-data-table`, `security-screen`, `run-panel`, `command-palette`, `conflict-banner`, `accounts`, `app-shell`, `frame` and their libraries).
- [Assurance bundle](../../docs/primitives.md#assurance-bundle): `security-screen` renders the `assurance.*` queries for listed auditors.

A worked `screens` entrypoint is [`examples/project-tasks/screens.tsx`](../../examples/project-tasks/screens.tsx).

## Entrypoints

| Import                             | Runs in    | Contents                                                                                                        |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `@agent-native/frame/screens`      | browser    | `defineScreens`, `screenForCapability` and the `ApplicationScreens` types. Free of `@/` imports.                |
| `@agent-native/frame/vite`         | build time | `frame({ appSource, configPath, outRoot })`: Vite plugins and the output directory `dist/web/<application id>`. |
| `@agent-native/frame/components/*` | browser    | Registry components under `src/components/`, for example `security-screen` or `ui/native-dialog`.               |
| `@agent-native/frame/lib/*`        | browser    | `session` (transport, client, live bindings, query client), `ui-session`, `host-client`.                        |

Inside a Vite build that uses the plugin, frame files are imported through the `@/` alias exactly as they will be after `shadcn add`: `@/frame`, `@/launch`, `@/components/run-panel`, `@/lib/session`. The alias resolves against the starter's `src` first, then this package, then the operator registry, so a starter file at the same path replaces the frame's.

Build the registry with `bun run build:registry` (output in `dist/registry`).

## Trust boundary

The frame imports no application; `virtual:agent-native/screens` is resolved from `app.config.json` at build time. The launch credential travels in the URL fragment, never reaches a server log, is removed from the address bar first and is exchanged once for an HttpOnly session cookie; the transport carries no token. Cache and bindings live as long as the page, and a new launch reloads it with an empty cache. The window title comes from the trusted starter identity, not the template.

The palette lists only operations the session's grant allows and never offers integration-only operations. Rendering `accounts` never reads the OS vault. `native-dialog` uses the `<dialog>` element because the authority's CSP forbids injected `<style>` tags. `live-data-table` never filters or paginates client-side over a partial set: the authority counts and pages after scoping.

`defineScreens` fails at definition time on a duplicate route or on a navigation or capability target that no route declares.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/client`, `@agent-native/react`, `@agent-native/assurance/contracts`, `@agent-native/host/manifest` and `@agent-native/host/config` (the Vite plugin only). External: `react`, `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-table`, `lucide-react`, `vite`. Stock shadcn primitives come from the starter's `src/components/ui`. Browser files must not import host-only modules; `bun run check:boundaries` bundles every application through this frame to prove it.

## Tests

```sh
bun run check:boundaries
bun run build:web:examples
bun run test:e2e
```

The frame has no unit suite of its own. `check:boundaries` builds every example's screens through the starter's real Vite config ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application)); the Playwright specs in `examples/*/e2e` drive the frame in Chromium, including live updates and draft conflicts ([P5](../../docs/principles.md#p5--every-committed-change-reaches-every-authorized-view-whatever-its-origin)).
