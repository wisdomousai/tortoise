# @agent-native/frame

The [web frame](../../docs/glossary.md#web-frame): the domain-neutral browser shell around one application's [screens](../../docs/glossary.md#screen). It supplies the [launch exchange](../../docs/glossary.md#launch-exchange) and session, hash routing, navigation, the capability palette, the agent run panel and accounts, and fills them from the configured application's `screens` entrypoint. Its Vite plugin binds that entrypoint to a virtual module, so the starter's source never names content. The same parts ship as a shadcn registry, so a starter can copy and own any of them.

## Layer

Framework (`packages/*`). Browser code, plus a build-time Vite plugin. The frame trusts the starter identity in `app.config.json`. It treats OS input and provenance labels as untrusted.

## Primitives

- [Web frame](../../docs/primitives.md#web-frame): `Frame`, `ScreensProvider`, `useScreens`, `screenForCapability`, `exchangeLaunch`, and the `frame` Vite plugin.
- [Application](../../docs/primitives.md#application): `defineScreens`, `ApplicationScreens`, the browser entrypoint of every application.
- [UI registry](../../docs/primitives.md#ui-registry): the `agent-native` shadcn registry in [`registry.json`](registry.json): `capability-form`, `live-data-table`, `collection-screen`, `approval-review`, `reconciliation-review`, `run-panel`, `command-palette`, `conflict-banner`, `os-provenance`, `accounts`, `app-shell`, `frame` and their libraries.
- [Approval request](../../docs/primitives.md#approval-request): `approval-review` lists pending approval requests live with Approve and Reject. The instance's refusal or conflict shows on the approval request, which stays open.
- [UI session context](../../docs/primitives.md#ui-session-context): `useUiSession(resource, handlers)` registers a record screen's selection and applies intents with `applyUiIntent`. An open navigates through `resourcePath` from `screens.resources`; a review is returned for the screen to show.
- [Display metadata](../../docs/primitives.md#display-metadata): `CollectionScreen`, `RecordScreen`, `capability-form` and the command palette read a capability's `display`.
- [Reconciliation](../../docs/primitives.md#reconciliation): `reconciliation-review` lists held effects live with what was sent, and offers Applied, Not applied and Refused.
- [OS handler](../../docs/primitives.md#os-handler): `useOsDeliveries` (mounted at the frame root), `usePreparedInput`, `useShownProvenance`, `OsProvenanceNotice`, `describeProvenance` and `ApplicationScreens.resources`, the screen that shows each selectable resource kind. `describeProvenance` is re-exported from `@agent-native/shell/provenance`, which the native frame shares.
- [OS handler](../../docs/primitives.md#os-handler): `useBrowserOsInput`, mounted at the frame root, is the browser shell adapter. It submits the link, shortcut or share claim in a landing URL and the files an installed web application was launched with.
- [OS action](../../docs/primitives.md#os-action): `runOsAction` asks for a declared action. When no adapter performs it, the frame runs the returned open or share in the browser.
- [Generator](../../docs/primitives.md#generator): the `frame` Vite plugin writes `icon.svg` and `manifest.webmanifest`, with the name, the icon, and the protocol handlers, file handlers and shortcuts from `webManifestOs`.
- [Feature](../../docs/primitives.md#feature): `defineFeatureScreens`, `FeatureScreens`. `defineScreens({ manifest, features })` merges a feature's routes, navigation and capability screens before its checks.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginScreens`, `PluginScreens`, the same shape. `defineScreens({ manifest, plugins })` merges plugin screens after feature screens.

A worked `screens` entrypoint is [`examples/field-service/screens.tsx`](../../examples/field-service/screens.tsx).

## Entrypoints

| Import                               | Runs in    | Contents                                                                                                                |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/frame/screens`        | browser    | `defineScreens`, `screenForCapability` and the `ApplicationScreens` types. Free of `@/` imports.                        |
| `@agent-native/frame/feature-screens` | browser   | `defineFeatureScreens`, `FeatureScreens`: a feature's routes, navigation and capability screens.                        |
| `@agent-native/frame/plugin-screens` | browser    | `definePluginScreens`, `PluginScreens`: a plugin's routes, navigation and capability screens.                           |
| `@agent-native/frame/vite`           | build time | `frame({ appSource, configPath, outRoot })`: Vite plugins and the output directory `dist/web/<application id>`.         |
| `@agent-native/frame/components/*`   | browser    | Registry components under `src/components/`, for example `run-panel` or `ui/native-dialog`.                             |
| `@agent-native/frame/lib/*`          | browser    | `session` (transport, client, live bindings, query client), `ui-session`, `os-deliveries`, `os-browser`, `host-client`. |

Inside a Vite build that uses the plugin, frame files are imported through the `@/` alias exactly as they will be after `shadcn add`: `@/frame`, `@/launch`, `@/components/run-panel`, `@/lib/session`. The alias resolves against the starter's `src` first, then this package, then the operator registry. A starter file at the same path therefore replaces the frame's.

Build the registry into `dist/registry`:

```sh
bun run build:registry
```

### Routes and layout

Routes render inside the sidebar shell, or full-window with `layout: 'full'` for a workstation screen. Both layouts are pathless routes, so a screen reads its params with `useParams({ strict: false })`. A `from:` route ID no longer matches. The shell fills its slots from `screens`: title, context line, a sidebar section above the navigation, navigation count badges and status. `app-shell` exports `NavigationCount`, `SidebarSection` and `SidebarLink` for those slots.

The shell's two-column breakpoint is 64rem. Below it, on phones and on tablets in portrait or in a hub's WebView, the sidebar becomes a bar. The bar holds the title, a menu button that opens the same panel as a sheet, and the palette button. A route may declare `compact`, a component rendered there instead of `component`. `useCompact()` (`src/lib/compact.ts`) is the same test for a screen that adapts in place.

## Trust boundary

### Launch and session

The frame imports no application, feature or plugin. Their screens arrive through `defineScreens({ features, plugins })`, and `virtual:agent-native/screens` is resolved from `app.config.json` at build time.

The launch credential travels in the URL fragment and never reaches a server log. The frame removes it from the address bar first and exchanges it once for an HttpOnly session cookie. The transport carries no token. Cache and bindings live as long as the document, and a new launch reloads it with an empty cache. The window title comes from the trusted starter identity, not the template.

### Palette and components

The palette lists only capabilities the session's grant allows and never offers integration-only capabilities. Rendering `accounts` never reads the OS vault. `native-dialog` uses the `<dialog>` element because the instance's CSP forbids injected `<style>` tags.

`live-data-table` never filters or paginates client-side over a partial set; the instance counts and pages after scoping. `collection-screen` builds a collection's list and record screens over `live-data-table` and `capability-form`. It uses the collection's generated `list`, `get`, create and update capabilities, so it inherits the same paging rule. A record the caller may not see shows as unavailable.

`defineScreens` checks the application's, its features' and its plugins' screens together. It fails at definition time on:

- a duplicate route;
- a navigation or capability target that no route declares;
- feature or plugin screens without the application's `manifest`, for a unit the manifest does not compose, or out of the manifest's order;
- a unit capability screen whose prefix is outside the unit's operation namespace, so a unit's palette entries open only its own capabilities.

### OS requests

What an OS request asks for, such as a link or an opened file, reaches the frame as a delivery for the session that submitted it. The frame root takes deliveries once a second while the document is visible. Each delivery does one of these:

- opens a resource through `screens.resources`;
- navigates to a screen;
- holds a prefill and navigates to the capability's screen.

A prefill fills `CapabilityForm` fields only, never its fixed inputs. The form shows the prefill's provenance above it and commits only when the person submits. A purpose-built form reads the prefill with `usePreparedInput`. Provenance labels come from the sender and are rendered as text.

In a browser the frame root also submits OS input. A landing URL counts only with exactly one `os` or `os-shortcut` parameter. The frame removes the parameter from the address before anything else, so a reload never submits it again.

A file from the launch queue is read only when a declared file handler lists its extension or media type, within that handler's `maxBytes`. A text payload is read as strict UTF-8. A blob payload is first uploaded to `/api/v1/blobs` as the document's session and then submitted as its reference. Any web page can link to a landing URL, so such a request can only open or prefill.

`runOsAction` opens a URL only from an instruction the host built from a declaration. It opens the URL in a new browsing context without an opener. The web manifest's handlers take effect only after the person installs the application in a Chromium browser. The manifest is generated from the trusted identity and the declarations, never from content at runtime.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/shell`, `@agent-native/client`, `@agent-native/react` and `@agent-native/operator-ui` (the alias's last source). The Vite plugin alone uses `@agent-native/host/manifest`, `@agent-native/host/config` and `@agent-native/host/components`. External: `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-table`, `lucide-react`, with `react` and `vite` as peer dependencies. Stock shadcn primitives come from the starter's `src/components/ui`.

Browser files must not import host-only modules. `bun run check:boundaries` bundles every application through this frame to prove it.

## Tests

```sh
bun test packages/frame
bun run check:boundaries
bun run build:web:examples
bun run test:e2e
```

`test/screens.test.ts` covers feature and plugin merging and the manifest checks. The frame has no other unit suite. `check:boundaries` builds every example's screens through the starter's real Vite config. The Playwright specs in `examples/*/e2e` drive the frame in Chromium, including live updates and draft conflicts.

## Skills

- [build-screens](skills/build-screens/SKILL.md): add or change web screens, registry items or starter frame files.
