# @agent-native/frame

The domain-neutral browser shell around one application's screens. The frame supplies the launch exchange and session, hash routing, navigation, the capability palette, the agent run panel, accounts, and fills them from the `screens` entrypoint of the configured application. Its Vite plugin binds that entrypoint to a virtual module, so the starter's source never names content. The same parts ship as a shadcn registry, so a starter can copy and own any of them.

Layer: framework (`packages/*`). Browser code, plus a build-time Vite plugin.

## Primitives

- [Web frame](../../docs/primitives.md#web-frame): `Frame`, `ScreensProvider`, `useScreens`, `screenForCapability`, `exchangeLaunch`, and the `frame` Vite plugin.
- [Application](../../docs/primitives.md#application): `defineScreens`, `ApplicationScreens`, the browser entrypoint of every application.
- [UI registry](../../docs/primitives.md#ui-registry): the `agent-native` shadcn registry in [`registry.json`](registry.json) (`capability-form`, `live-data-table`, `collection-screen`, `proposal-review`, `run-panel`, `command-palette`, `conflict-banner`, `os-provenance`, `accounts`, `app-shell`, `frame` and their libraries).
- [Proposal](../../docs/primitives.md#proposal): `proposal-review` lists open proposals live with Accept and Reject; the authority's refusal or conflict shows on the proposal, which stays open.
- [OS handler](../../docs/primitives.md#os-handler): `useOsDeliveries` (mounted at the frame root), `usePreparedInput`, `useShownProvenance`, `describeProvenance` (re-exported from `@agent-native/shell/provenance`, which the native frame shares), `OsProvenanceNotice`, and `ApplicationScreens.resources`, the screen that shows each selectable resource kind. `useBrowserOsInput` (mounted at the frame root) is the browser shell adapter: it submits the link or shortcut in a landing URL and the files an installed web app was launched with.
- [OS action](../../docs/primitives.md#os-action): `runOsAction`, which asks for a declared action and, when no adapter performs it, runs the returned open or share in the page.
- [Generator](../../docs/primitives.md#generator): the `frame` Vite plugin writes `manifest.webmanifest` (name, icon, and the protocol and file handlers and shortcuts from `webManifestOs`) and `icon.svg`.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginScreens`, `PluginScreens`; `defineScreens({ plugins })` merges a plugin's routes, navigation and capability screens before its checks.

A worked `screens` entrypoint is [`examples/project-tasks/screens.tsx`](../../examples/project-tasks/screens.tsx).

## Entrypoints

| Import                               | Runs in    | Contents                                                                                                                |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/frame/screens`        | browser    | `defineScreens`, `screenForCapability` and the `ApplicationScreens` types. Free of `@/` imports.                        |
| `@agent-native/frame/plugin-screens` | browser    | `definePluginScreens`, `PluginScreens`: a plugin's routes, navigation and capability screens.                           |
| `@agent-native/frame/vite`           | build time | `frame({ appSource, configPath, outRoot })`: Vite plugins and the output directory `dist/web/<application id>`.         |
| `@agent-native/frame/components/*`   | browser    | Registry components under `src/components/`, for example `run-panel` or `ui/native-dialog`.                             |
| `@agent-native/frame/lib/*`          | browser    | `session` (transport, client, live bindings, query client), `ui-session`, `os-deliveries`, `os-browser`, `host-client`. |

Inside a Vite build that uses the plugin, frame files are imported through the `@/` alias exactly as they will be after `shadcn add`: `@/frame`, `@/launch`, `@/components/run-panel`, `@/lib/session`. The alias resolves against the starter's `src` first, then this package, then the operator registry, so a starter file at the same path replaces the frame's.

Build the registry with `bun run build:registry` (output in `dist/registry`).

## Trust boundary

The frame imports no application and no plugin: plugin screens arrive through `defineScreens({ plugins })`; `virtual:agent-native/screens` is resolved from `app.config.json` at build time. The launch credential travels in the URL fragment, never reaches a server log, is removed from the address bar first and is exchanged once for an HttpOnly session cookie; the transport carries no token. Cache and bindings live as long as the page, and a new launch reloads it with an empty cache. The window title comes from the trusted starter identity, not the template.

The palette lists only operations the session's grant allows and never offers integration-only operations. Rendering `accounts` never reads the OS vault. `native-dialog` uses the `<dialog>` element because the authority's CSP forbids injected `<style>` tags. `live-data-table` never filters or paginates client-side over a partial set: the authority counts and pages after scoping. `collection-screen` builds a collection's list and record screens from its generated `list`, `get`, create and update capabilities over `live-data-table` and `capability-form`, so it inherits the same paging rule; a record the caller may not see shows as unavailable.

What an OS request asks for (a link, an opened file) reaches the frame as a delivery for the session that submitted it. The frame root takes deliveries once a second while the page is visible: it opens a resource through `screens.resources`, navigates to a screen, or holds a prefill and navigates to the capability's screen. A prefill fills `CapabilityForm` fields only, never its fixed inputs, shows its provenance above the form and is committed only when the person submits; a purpose-built form reads it with `usePreparedInput`. Provenance labels come from the sender and are rendered as text.

In a browser the frame root also submits OS input. A landing URL counts only with exactly one `os` or `os-shortcut` parameter; the parameter is removed from the address before anything else, so a reload never submits it again. A file from the launch queue is read only when a declared file handler lists its extension or media type, within that handler's `maxBytes`: a text payload as strict UTF-8, a blob payload uploaded to `/api/v1/blobs` as the page's session first and submitted as its reference. Anything a web page can link to arrives this way, which is why such a request can only open or prefill. `runOsAction` opens a URL only from an instruction the host built from a declaration, in a new browsing context without an opener. The web manifest's handlers take effect only after the person installs the application in a Chromium browser; the manifest is generated from the trusted identity and the declarations, never from content at runtime.

`defineScreens` fails at definition time on a duplicate route or on a navigation or capability target that no route declares, checked over the application's and its plugins' screens together.

Routes render inside the sidebar shell or, with `layout: 'full'`, full-window (a station screen). Both layouts are pathless routes, so a screen reads its params with `useParams({ strict: false })`; a `from:` route id no longer matches. The shell fills its slots from `screens`: title, context line, a sidebar section above the navigation, navigation count badges and status. `app-shell` exports `NavigationCount`, `SidebarSection` and `SidebarLink` for those slots.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/shell`, `@agent-native/client`, `@agent-native/react`, `@agent-native/host/manifest` and `@agent-native/host/config` (the Vite plugin only). External: `react`, `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-table`, `lucide-react`, `vite`. Stock shadcn primitives come from the starter's `src/components/ui`. Browser files must not import host-only modules; `bun run check:boundaries` bundles every application through this frame to prove it.

## Tests

```sh
bun run check:boundaries
bun run build:web:examples
bun run test:e2e
```

The frame has no unit suite of its own. `check:boundaries` builds every example's screens through the starter's real Vite config; the Playwright specs in `examples/*/e2e` drive the frame in Chromium, including live updates and draft conflicts.
