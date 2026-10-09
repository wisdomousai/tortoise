# 010 — Host plugins and a deny-by-default kernel

Accepted; amended by [ADR 011](011-plugins-by-port.md), which splits the security and assurance plugins below into `site`, `network`, `audit` and `compliance`. Amends [P11](../principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application) and [P13](../principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does), and replaces the wiring parts of [ADR 007](007-declared-egress-and-audit-log.md). ADR 007's controls are unchanged: declarations, site policy, the egress guard, the fail-closed audit log and the generated evidence. What changes is who composes them. The host is a kernel with ports and safe null defaults. Security and assurance are plugins an application lists, written only against the public plugin API that any third party uses.

**Context.** The host hard-wired one security layer into every application. `host/security.ts` imported the egress guard, the event log and assurance. The listener, agent launcher, CLI and serve banner reached into one concrete `Security` object, and the CLI imported the assurance verbs. Every example repeated about 30 lines of assurance composition: a state slice, slice handlers, an authorization route, the module in the manifest, and a route, navigation item and capability prefix in its screens. Adding a cross-cutting concern meant editing the host, and nothing showed how an outside package would extend it.

**Decision.**

- **A plugin mirrors an application's three entrypoints.**
  - `definePluginManifest` (browser-safe) declares modules, requirement components and settings.
  - `defineHostPlugin` (server) declares a state slice, handlers, a policy over its resource types, CLI commands and `open`.
  - `definePluginScreens` (browser) declares routes, navigation and capability screens.
  - The application lists the plugins in each of its own entrypoints: `defineManifest({ plugins })`, `defineApplication({ plugins })` and `defineScreens({ plugins })`. Generated artifacts, UI-binding checks and the frame see plugin operations exactly like the application's own.
- **Composition isolates state and policy.**
  - A plugin's state lives under its id. The application's `upgradeState` never sees plugin keys, so it cannot drop or rewrite them.
  - The plugin's handlers and policy receive only its slice. The plugin policy decides plugin operations and events of its resource types; the application policy decides everything else.
  - The server and manifest plugin lists must match in order, and `requires` must name plugins composed earlier.
- **The kernel exposes ports with null defaults.**
  - The ports are `network`, `ingress`, `identity` and an optional `eventLog`.
  - With no provider: every network call is `UNAVAILABLE`, the listener binds loopback, identity admits the trusted local owner, and there is no audit log.
  - Two providers of one port refuse startup.
  - The runtime is unchanged. Its existing `eventLog` port was already the in-transaction seam.
- **The lifecycle is explicit.**
  - `open` runs in order before storage, receiving the services of earlier plugins. A refusal there (an unusable policy, an unwritable log) stops startup before any state is opened, and a failed `open` closes the plugins already opened.
  - `ready` runs after the runtime exists and before the first request: attestation and crash recovery.
  - `start` runs only in a serving host, after it listens. It receives `delegate(grant)`, a local-owner context narrowed by a grant, so a plugin loop is a caller like an agent run and writes through commands.
  - `close` runs in reverse order, last.
- **Settings are claimed.** A plugin declares each launcher input as `{ key, env, kind }`. The CLI reads `--<key>`, the service reads `env`. A supplied setting that no composed plugin declares refuses startup. Without this, a site policy passed to an application without the security plugin would run unenforced while looking configured.
- **Security and assurance become plugins.**
  - `@agent-native/security` provides all four ports from the site policy: the egress guard and child proxy, mTLS ingress, identity floors, and the event log with forwarding. Its `ready` attests and recovers.
  - `@agent-native/assurance` requires `security`. It owns the `assurance` slice, queries, posture monitor, CLI verbs and Security screen.
  - `check:boundaries` fails when `packages/host/src` imports `egress` or `event-log`, which only the security plugin uses.
- **Plugins are a layer.** Every plugin lives in `plugins/<name>`: `plugins/security` and `plugins/assurance` ship with the framework, and `plugins/webhook` stands in for a third party's. Browser code is `plugin-manifest`, `plugin-screens`, `contracts`, `ui/` and `components/`, and everything else is server code, so one boundary rule covers every plugin without naming it. A plugin imports the framework and the plugins it requires. The framework and the starter never import a plugin, and a plugin never imports the starter or an example; its tests use fixture applications. The Security screen therefore moved from the frame registry into the assurance plugin, which ships it as its own registry item (`plugins/assurance/registry.json`).
- **A third-party plugin proves the API.** `plugins/webhook` posts ids of observed changes to a declared `webhook-target` destination through the network port, as a delegated caller, with a durable cursor in its own slice. `project-tasks` composes it.

**Consequences.**

- A cross-cutting concern is a package an application lists, not a host change. A forked starter keeps receiving kernel changes without merging security code it may replace.
- Composing the security plugin is now the application's choice. Every example composes it. An application without it is isolated, not open, because every network default refuses. It also has no audit log; its generated security manifest then lists no `audit-collector` destination, so a reviewer sees the difference.
- Plugin order is part of the application: it decides service visibility and close order.
- Persisted `assurance` slices load unchanged, because the slice key is the plugin id the examples already used.
- Environment variables that no plugin declares are never read, so they are not refused. Only explicitly supplied settings and flags are.

**Alternatives considered.**

- Keep security in the host behind a feature flag: one fewer package, but the host keeps a security concept and nothing demonstrates extension.
- Plugins registered by the starter rather than the application: they would then apply to whatever application the starter hosts, and generated artifacts would no longer follow from the application alone.
- Generic middleware around every call: it cannot express in-transaction audit, egress binding or start-up refusal, which are the guarantees that matter.

See [security-and-compliance.md](../security-and-compliance.md) and [primitives: Host plugin](../primitives.md#host-plugin).
