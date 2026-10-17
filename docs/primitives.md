# Primitives

At its core the framework is one idea: **a capability catalog over a logical CQRS authority, where every caller uses the same contract.** Commands change state through one authority; queries read authorized snapshots; a journal tells every view what changed. People, agents, scripts, jobs, scanners and connectors are all callers of that contract. None of them gets a private path.

AI is not the center of this design and not a special case. An agent is a caller like any other, reaching the catalog through MCP or the CLI under a delegated grant. Where models work inside the system, reading a screen or proposing a click, they sit behind ports and only propose; deterministic code validates, acts and verifies. Everything here works without a model.

The other primitives extend that core in three directions: **callers** reaching it from every surface, **integrations** connecting it to systems that keep their own records, and the **trust, configuration and proof** that let one framework serve many sites. [Edge applications](edge-applications.md) describes the on-site deployment: the application, its connectors and the agents that call it, on or beside the machine where work happens.

```mermaid
flowchart LR
  subgraph Callers
    Person[Person: screen, scanner]
    Agent[Agent run]
    Script[Script, job, CLI]
  end
  Catalog[Catalog] --> Surface
  Callers --> Surface[Surface adapters]
  Surface --> Command
  Surface --> Query
  subgraph Authority
    Command --> Store[(Storage: state, receipts, journal, outbox)]
    Query --> Store
  end
  Store --> Live[Journal and live query] --> Callers
  Store --> Outbox[Outbox effect] --> Dispatcher --> Connector
  Connector --> External[(System of record or station screen)]
  External --> Inbound[Inbound sync] --> Command
  Query -. remote query .-> External
  External --> Observation --> Command
```

## How to read an entry

Each entry gives a one-line definition, the problem the primitive solves and how it relates to its neighbors, the **guarantees** an application may rely on, and any known **gaps**. The last line points to the code:

`<status> · <locations>`

Each location has a README that links back to every entry naming it and lists the exports, entrypoints, trust boundary, dependencies and tests. `bun run check:readmes` fails when the two disagree. Entries describe concepts and stay true across renames; names of exports live in the READMEs.

Status is `implemented`, `partial` or `proposed`, and changes only with evidence in the [implementation ledger](implementation-status.md). Adapters, such as SQLite storage or the Codex harness, are listed with the port they implement. Domain code in `examples/*` is not a primitive; a domain concept is promoted only when a second application needs it.

## The core: describe, write, read

### Capability

_A named command or query, defined once as data._

Everything else in the framework hangs off capabilities. A capability names a business behavior with a stable ID, strict JSON schemas, the permission it needs and how the UI binds it. Because it is plain data, a browser, a generator and a test can all import it without loading handlers or drivers.

Guarantees: IDs and inferred types survive composition into typed clients. Wire values are JSON only, and validation rejects input it would have to strip or transform. A command that forwards to another system declares that its receipt is not upstream acceptance. A query that reads another system declares its target and the identity it may use (see [Remote query](#remote-query)).

implemented · `packages/contracts`

### Module

_The unit a domain contributes: capabilities, handlers, a state slice, a policy route, workflows and scenarios._

Modules are how an application is assembled from independently authored parts. Each is composed explicitly in the application definition, owns its slice of state and routes its own policy, so the line-station module and the reusable device configuration module share one authority without seeing each other's data.

Guarantees: nothing is discovered or registered globally. Handlers see only their module's slice. Operations and resources no module claims are denied.

implemented · `packages/contracts` `packages/runtime`

### Catalog

_The composed, validated description of everything the application can do._

The catalog is the single list that every surface and artifact reads. It is what makes "every operation from UI, MCP, CLI and API" true by construction instead of by discipline.

Guarantees: deterministic output. Composition fails before startup on duplicate IDs, missing or cyclic dependencies, missing UI declarations, unresolved workflow and agent references and colliding MCP names.

implemented · `packages/contracts`

### Generator

_A pure transformation from the catalog to a checked-in artifact._

JSON Schema, OpenAPI, the operation and workflow references, the application skill with CLI forms, and the security manifest, data flows and SBOM are generated, not written. Agents and auditors learn the application from the same source the UI is built from. Each application gets its own set under `docs/reference/<id>/`, built from its browser-safe manifest; the control mapping is the framework's and sits beside them.

Guarantees: generation opens no workspace, reads no credential, starts no server and loads no handler. Drift fails the build, including a reference directory no application produces any more. A boundary check keeps contract and browser code free of host-only modules, keeps the starter from importing content and content from importing the starter, and bundles every application's web entry to prove its browser graph.

implemented · `scripts`

### Authority

_The single runtime that owns a workspace and executes its commands and queries._

CQRS here is logical: one transactional authority with separate command and query paths, not two databases or an event-sourced model. One owner per workspace removes a whole class of dual-writer bugs; every other process attaches to it or runs it embedded.

Guarantees: an OS-held lock admits one owner per workspace, across path aliases, and a crash releases it without PID-file guessing.

implemented · `packages/runtime` `packages/adapters`

### Command

_An authorized write, submitted the same way by every caller._

The write side. A handler validates, mutates its state slice, declares what changed and may queue effects for other systems; the authority does the rest. Retries, double taps and restarted agent runs are safe because the receipt, not the caller, decides whether work already happened.

Guarantees: feature state, revisions, the idempotency receipt, journal entries and outbox effects commit atomically or not at all. Keys are scoped to workspace and principal; a reused key with other input conflicts. `expectedRevisions` makes stale writes conflict. Authorization and cancellation are rechecked before commit. An undeclared change fails. Errors share one caller-safe envelope.

A handler may call `continueWith(operation, input, expectedRevisions)` once to run one more command in the same transaction, as the same caller, through the whole pipeline: grant, authorization, preconditions, handler and commit recheck. Both commit or neither does. The receipt reports the follow-up as `continuation`, and a replay reauthorizes and returns it. A continued command cannot continue again, and a command cannot continue with itself. [Proposals](#proposal) use it to accept.

implemented · `packages/runtime` `packages/contracts`

### Query

_An authorized, side-effect-free read._

The read side. Queries are computed from the same transactional state, so there is no projection lag, and each returns a cursor so a caller can follow changes from exactly that point.

Guarantees: data and cursor come from one snapshot. Rows are scoped before filtering, pagination and counts. Output is projected to readable fields, then validated. Mutation inside a query fails. A [remote query](#remote-query) keeps every guarantee except the single snapshot: its items come from another system between two snapshots.

implemented · `packages/runtime`

### Collection

_A typed set of records a module keeps in its state slice, with generated reads._

Every application holds keyed records: accounts, lots, tasks. `defineCollection` names the record type, its journal resource prefix (`<type>:<key>`), the visible record and, optionally, the field that names its container. `collectionGet` and `collectionList` turn it into ordinary catalog queries with literal IDs; `collectionGetHandler` and `collectionListHandler` serve them with the module's own visibility rule. Inside commands, `records(ctx, collection, store)` gives prototype-safe `get`, `getExisting`, `insert`, `set`, `update` and `remove` that declare each changed record. It is not an ORM: records stay a plain keyed object in the module's slice and commit with the rest of the state.

Guarantees: a write through `records` always declares `<type>:<key>`, so revisions, `expectedRevisions` conflicts and the journal apply to it. Keys such as `__proto__` stay ordinary keys. A generated list applies the visibility rule to every row before equality filters, search, counting and paging, and a generated get answers `NOT_FOUND` for a record the caller may not see. Search runs only over the text the handler supplies, so hidden fields are never searchable unless the handler includes them.

The frame's `collection-screen` registry item gives a collection default list and record screens over those queries and its create and update commands, and `scaffold add collection` writes all of it.

Gaps: paging is by offset, so a page can shift when records are added between requests. Generated lists filter by equality only. The framework generates no create or update commands; `scaffold add collection` writes them as ordinary handlers over `records`, which the application then owns.

implemented · `packages/contracts` `packages/runtime`

### Execution context

_Who is calling, in which workspace, under which delegation grant._

This is how a person, an agent and a job can share operations without sharing authority. The host derives the context; an agent run inherits a narrowed grant from the person who started it.

Guarantees: operation input cannot set or widen it. Grants narrow by operation, resource, expiry and run and are rechecked after every awaited step. Launchers fix the grant of embedded or attached agent processes through a grant file.

implemented · `packages/runtime` `packages/adapters`

### Policy

_The port that decides operation, object, row and field access._

Policy is injected so an application can bring its own rules engine. `definePolicy` compiles a declarative description into the port: integration lanes, a caller gate, one rule per operation (`open`, `integration`, or a rule naming the container, grant resource, roles, person-only flag and a further check) and journal visibility by resource type. The reference adapter uses a bounded CASL profile whose row scopes translate to both memory predicates and SQL; a rule's check can use it, as `project-tasks` does for field-level edits.

Guarantees: decisions use authoritative state, never caller-supplied attributes. Scope translations are tested for agreement. Unknown operations and unsupported conditions fail closed. Under `definePolicy` the order is fixed: an unlisted operation is denied, an integration principal may call only its lane, a lane's operations are closed to everyone else, then the caller gate, the person-only check, the grant's resources, the container role and the rule's check, on the current and, at commit, the proposed state. An unlisted event type is never readable. A lane naming an operation the policy does not list fails at definition.

Gaps: row scopes are still written in handlers (`visible` on a collection list); `definePolicy` does not compile rules to CASL scopes or SQL.

implemented · `packages/runtime` `packages/adapters`

### Membership

_Roles that people hold in a container: a project, plant or station._

`defineMembership` declares the container (its input field, journal resource type and permission subject), the roles and the role that manages them, and generates the `<id>.set-member` command. `membershipHandler` implements it over the application's own role map, and `membershipRule` is its policy rule; `roleIn` reads a role. quality-inspection (plants) and line-station (stations) use it.

Guarantees: only the manager role in that container may change roles. Nobody changes their own role, and principals the application reserves (integration principals) never get one. A change is the container's `authorization.changed` event, so open views drop protected data in the same commit. Inherited keys are never roles.

Gaps: there is no generated membership list; each application still reads roles in its own queries. Workspace-wide roles, as in crm-capture, and project-tasks' fixed owner are not expressed with it.

implemented · `packages/contracts` `packages/runtime`

### Storage

_The port for the authority's transactional state._

Storage holds feature state together with the framework's receipts, revisions, journal and outbox, which is what lets a command commit all of them at once. Memory and SQLite snapshot adapters ship; the SQLite one runs over a small synchronous driver, so the desktop and the phone share it. A production store implements the same port.

Guarantees: atomic `transact` and consistent `read` per workspace; rejected work commits nothing. A replacement passes the storage conformance suite.

Gaps: the SQLite adapter rewrites one JSON snapshot per commit, and the journal is never pruned.

implemented · `packages/runtime` `packages/adapters`

### Blob store

_Content-addressed bytes, such as photos and documents, that commands reference from resources._

Photos and scanned pages are too large for a snapshot that is rewritten on every commit. A caller uploads the bytes first and gets back a reference (digest, size, media type). A command then attaches that reference to a resource it changes, in the same transaction as the change, and state, input and effect payloads carry only the reference. The workspace records which resources reference each blob. A caller may read a blob when it may read one of those resources, so a blob follows the policy of the records it belongs to. Commands declare the size and media types they accept, and an upload is refused unless an operation the caller may invoke would accept it. Connectors read the blobs attached to an effect's resource and upload them before delivering the record.

Guarantees: an attachment commits with its command or not at all. Attaching needs the caller's own recent upload or read access to a resource that already references the blob, so learning a digest grants nothing; every refusal looks the same. Reads re-evaluate policy each time, so a revocation takes effect on the next read, and HTTP serves blobs sandboxed, unsniffed and uncached. Unreferenced blobs are removed after a grace period; a referenced blob is never removed. Uploads, reads and refusals are audited by digest.

Gaps: bytes travel whole, not streamed. MCP and the CLI do not carry blobs. Staged uploads live in memory, so an upload must be attached before the authority restarts. A serving authority sweeps only when it opens. No mobile store exists yet.

partial · `packages/contracts` `packages/runtime` `packages/adapters` `packages/client` `packages/kernel`

### Journal and live query

_The ordered record of committed changes, and the client machinery that follows it._

The journal closes the CQRS loop: whatever wrote the change, every view that may see it learns about it and re-reads through an authorized query. That is why a change made by an agent over MCP appears on an operator's screen without a refresh.

Guarantees: events carry resource references and revisions, never record contents, and are filtered by current access. Clients subscribe from their query's cursor, so nothing falls between snapshot and stream. Invalidation follows the catalog's resource dependencies and is coalesced. An authorization change resets views without leaking identifiers. It clears cached data at once, even while a refetch is still pending, and it covers snapshots cached before the stream's first batch. Remote query results are excluded from change-driven refetches but not from that reset.

implemented · `packages/runtime` `packages/client` `packages/react`

### Application

_One unit of content: the definition a host runs._

An application is a package with three entrypoints. `manifest` is browser-safe: its id, title, composed modules and the components it brings (a screen bridge, device drivers), with their declared requirements. `application` is server code: state factory and upgrades, composed policy, handlers, services, selectable resources and `connect`, which wires systems of record (demo fakes included) and observers once per authority. `screens` is browser code: routes (each in the sidebar shell or, with `layout: 'full'`, full-window for a station), navigation with optional count badges, capability screens, and the shell's slots: title, context line, a sidebar section above the navigation, and status. Layouts are pathless routes, so screens read route params with `useParams({ strict: false })`. The starter names one application in its configuration and the host and frame resolve these entrypoints, so adding an application changes no framework or starter code. Each example in `examples/*` is one application. Each entrypoint also lists the application's [host plugins](#host-plugin), in the same order. The manifest may name its `targets` (desktop, web, mobile); each target maps to [host platforms](#host-platform) and every listed plugin must run on them.

Guarantees: one catalog, generated reference set, web bundle and workspace per application. `defineApplication` fails when a selectable resource names an operation the manifest does not compose; `defineManifest` rejects an invalid id or a duplicate module, plugin modules included; `defineApplication` rejects a plugin list that differs from the manifest's; `defineScreens` rejects a navigation target with no route, after merging plugin screens. A definition is trusted code; only callers are untrusted.

implemented · `packages/kernel` `packages/host` `packages/frame`

### Host

_The domain-neutral authority process that runs one application definition._

The host owns everything an application should not rewrite: workspace ownership, storage, launch and sessions, HTTP/SSE, embedded MCP, the CLI, run supervision and background delivery. It receives a definition and composes the runtime, integrations and observers from it; it names no domain and no security concept. It is a kernel: what crosses the process boundary (network, ingress, caller identity, the audit log) goes through [ports](#host-plugin) whose defaults refuse the network, bind loopback and keep no log, and the definition's plugins provide anything more.

Guarantees: one authority per workspace, enforced by the same OS lock for a serving host and an embedded one. Embedded authorities never start observers. Observers start only after the host listens, and a failed start stops the ones already running. `loadApplication` and `loadManifest` resolve the configured application at runtime; compiled builds use a generated static entry because a binary cannot follow that import. Opening an authority (plugins, identity, storage, runtime, `ready`, integrations) is portable and runs on any [host platform](#host-platform); the Bun host supplies one platform.

implemented · `packages/kernel` `packages/host`

### Host plugin

_A cross-cutting part an application composes: modules, a state slice, a policy, ports and lifecycle hooks._

Some concerns belong to many applications but to no domain: a site policy, an audit trail, compliance evidence, a notifier. A plugin has the same three entrypoints as an application, and the application lists its plugins in each of them. Plugins can provide the kernel's ports, hand a service to later plugins, and use each other through the composed ports rather than through imports. A plugin declares the [host platforms](#host-platform) it runs on (absent means Bun only). A plugin can provide settings for other plugins before any of them opens, as `plugins/managed-config` does with the values device management pushes. A plugin that needs native code on a phone ships an Expo module and names it, and optionally an Expo config plugin, in its manifest; the mobile build links the module and runs the config plugin with the settings the composed plugins declare. A plugin runs code at fixed points: before storage opens, before the first request, once a serving host listens (as a delegated caller), and at shutdown in reverse order. `plugins/webhook` stands in for a third-party plugin.

Guarantees: a plugin's state is its own slice, which the application's upgrade and other plugins cannot rewrite, and its policy decides only its own operations and resource types. The kernel's ports default closed: no network, the platform's own listener (loopback on Bun, none on a platform without ingress) and no event log. A plugin listed on a platform it does not declare refuses startup. A manifest that names native code without a mobile platform is refused, and a plugin whose native module the build lacks refuses startup with the command that rebuilds it. Provided settings override launcher settings unless the launcher is a development build; two providers of one key refuse startup. A refusal while opening stops startup before state is opened. Two providers of one port, a supplied setting no plugin claims, and a port a plugin's configuration needs that nobody provides all refuse startup. `check:boundaries` keeps the framework and the starter from importing plugins, and plugins from importing the starter or content.

Gaps: plugins are trusted code with the host's privileges. Nothing sandboxes one plugin from another's services. Environment variables that no plugin claims are ignored rather than refused. The kernel fixes the set of port kinds, so a plugin cannot introduce a new one. Native plugin code (Kotlin, Swift) is not compiled by `bun run check`; only the prebuild output and autolinking have been checked.

implemented · `packages/kernel` `packages/host` `packages/frame` `packages/mobile` `plugins/managed-config`

### Host platform

_What the kernel needs from the machine it runs on: workspace ownership, storage, the host's own components and its capabilities._

The kernel opens an authority without any Node, Bun or React Native API. A platform supplies exclusive ownership of a workspace, the workspace's snapshot storage and [blob store](#blob-store), the requirements the host itself adds to every deployment (the Bun host's listener and agent providers), an optional default listener, and the set of capabilities it has: raw sockets, child processes and ingress. The Bun host is one platform; Android and iOS share the mobile platform, which has none of the three capabilities and owns its workspace with a lock database. Before plugins open, the kernel checks that the JavaScript host has the Web globals the runtime calls and installs the ones it can write in JavaScript.

Guarantees: a deployment that declares a socket destination, an ingress destination or a child process refuses startup on a platform without the matching capability, naming the component that declared it. A missing global refuses startup before any state opens. The runtime, client, integration and kernel suites also run with the globals Hermes may lack removed and the kernel's replacements installed. `check:boundaries` keeps Node and Bun imports and globals out of the portable packages.

Gaps: the mobile platform has run only in Bun tests with Bun's SQLite and files, not yet on a device. A platform is trusted code; nothing checks that its ownership is really exclusive beyond its own tests.

partial · `packages/kernel` `packages/host` `packages/mobile`

### Web frame

_The domain-neutral browser shell around one application's screens._

The frame supplies session and launch exchange, routing, navigation, the command palette, the run panel and accounts, and fills them from the application's screens. Its Vite plugin binds the configured application's `screens` entry to a virtual module and resolves `@/` imports from the starter first, then the frame, then the operator registry, so a starter file at the same path replaces the frame's.

Guarantees: the frame imports no application; the boundary check bundles every application through it. The same parts ship as a shadcn registry, so a starter can copy and own any of them.

implemented · `packages/frame`

### Native frame

_The domain-neutral React Native shell around one application's native screens._

An application that targets mobile declares its screens once in a `screens-native` entrypoint, and the frame supplies navigation, the session context and live invalidation over the authority's direct transport. Tabs sit at the bottom on phones and become a rail on tablets; other screens are pushed above them. Screens and capability targets are named by path, as on the web, so a capability opens the same screen in both frames.

Guarantees: the frame imports no application; definition fails on a dead target, a duplicate screen or a home that is not a tab, over the application's and its plugins' screens together. A new transport starts a new query cache. Signal colors come from the operator registry's manifest, so a state looks the same on a phone and at a station.

Gaps: the frame and its components have been bundled by Metro and type-checked, not rendered on a device. There is no compact web variant for attached tablets yet.

partial · `packages/frame-native` `apps/mobile`

### Starter

_The thin application a team forks or generates and then owns._

The starter wires framework to content: `app.config.json` names its identity and the application it hosts, `apps/service` serves it, `apps/web` frames its screens and `apps/desktop` wraps both. It holds no domain and no generic host code, so changing it never forks the framework; extending it is the owner's business. `AGENT_NATIVE_APPLICATION` overrides the configured application for one developer's launch. `bun run dev` opens that desktop window against the source service; a packaged build is the integrity-checked distribution of the same window.

Guarantees: the starter imports no content statically; the boundary check fails a direct import from `examples/*`. A development desktop launch cannot skip packaged digest checks: the development flag is honored only when Electron reports the app is unpackaged (`apps/desktop/test/development-launch.test.ts`).

`apps/mobile` hosts the application `targets.mobile` names (or the starter's) on Android and iOS: `bun run mobile:prepare` writes its static entry, and the app opens its authority on the device and renders its native screens.

Gaps: the mobile app has not run on a device, and attached mode does not exist.

implemented · `apps/service` `apps/web` `apps/desktop` `app.config.json`

## Callers: every surface on the same contract

### Surface adapter

_Maps one surface onto the authority's raw command and query entry points._

HTTP, MCP, the CLI and in-process calls are thin translations. They carry no business logic and keep no operation list, so adding a capability adds it to all of them.

Guarantees: MCP tool names, CLI subcommands and typed flags are derived from the catalog. MCP also serves the contract, each workflow and each agent definition as resources. Errors keep their meaning across surfaces: HTTP status, MCP tool error and CLI exit code map from the same code. A per-request signal only adds to the trusted context's cancellation (`withSignal`). Direct and HTTP cursors both carry the authorization revision they were issued under, so a subscription resets when access changed after the snapshot.

implemented · `packages/adapters`

### Capability binding

_A UI control bound to a capability through the typed client._

The UI's equivalent of a tool call. It turns a person's intent into exactly one command, however many times they tap.

Guarantees: one idempotency key per intent, kept across retries until commit. Validation uses the contract's schema and field errors map back to inputs. Drafts stay separate from committed data and conflict explicitly: a draft pins the object it edits (capture pins its characteristic and sample; scanner setup keeps the revision it loaded and saves with it as the expected revision), so an external write shows a conflict instead of retargeting or discarding the entry. Every operation that claims a UI binding is referenced by a screen of its application; an operation no screen offers declares an exception instead.

A search box binds a [remote query](#remote-query) through `remoteQueryOptions`, or `remoteInfiniteQueryOptions` for "show more" paging. It keeps the previous result on screen while the next input loads, and it aborts the superseded request at the source.

Gaps: the reference check proves a screen names the capability, not that a control renders it.

implemented · `packages/react`

### UI session context

_What a person is looking at, captured for an agent, and the intents an agent can send back._

This is the bridge between a person and an agent working on the same screen. The agent acts on what the person selected, at the revision they saw, and can ask the frontend to open or select something.

Guarantees: the host issues and binds sessions. Capture revalidates access and freezes the target, so later selection changes cannot retarget a run. Intents expire, are acknowledged and never write business records. Every provider adapter shows its model the captured selection through `modelPrompt`: resource references and the revisions the person saw, never identity, grant, provider selection or session ID. Contents still come only through tools.

implemented · `packages/adapters` `packages/react` `packages/agents`

### Agent run

_An agent session acting as one more caller on the catalog._

The supervisor makes an agent an ordinary caller: its tools are catalog operations, its authority is the narrowed grant of whoever started it, and its narration is kept apart from what it actually committed. Codex, Claude and AI SDK harnesses are adapters behind one port, next to a deterministic harness that needs no provider and a local harness over an OpenAI-compatible server on this host (llama.cpp, Ollama, vLLM). Each harness says where it sends prompts (`local`, `remote` or `none`) and may name its model and weights digest, which the run record keeps.

Guarantees: tools are catalog operations only. Text and progress stream separately from commits. Cancellation stops future work without undoing commits, and a restart marks unfinished runs interrupted instead of replaying them. A run started with a budget fails with `BUDGET_EXCEEDED` instead of making one tool call more than allowed or running past its wall time; the turn limit goes to the harness, and the Claude and AI SDK adapters lower their own limit to it. A caller may choose the run ID, as [triggers](#trigger) do, so a run repeated after a restart reuses its tool calls' idempotency keys. A run started with a model requirement refuses a harness that does not meet it, and a harness that does not declare where it sends prompts never meets `local`. The local harness reaches its server only through the `local-inference` destination, which is loopback-scoped, so the egress guard refuses a binding that leaves the host; it sends no provider key and reads no provider environment.

Gaps: the local harness reports the configured digest; it does not verify the served weights. No run has used a real local model yet. The host's run panel does not offer the local harness; trigger runs do.

implemented · `packages/agents`

### Agent definition

_A named agent in the catalog: its instructions, the operations it may call, its scope, model requirement, output mode and budgets._

`defineAgent` declares an agent on a module, next to its workflows. The catalog validates it like any other reference, the generator writes `agents.md`, names each agent on the operations it may call and lists agents in the application skill, and MCP serves each definition as `app://agents/<id>`. `agentGrant` turns a definition into the delegation grant a run executes with. A definition holds no authority of its own: a run acts as the person or grant that started it.

`direct` agents run their commands themselves. `propose` agents run their queries and record their commands as proposals for someone to accept; their grant leaves the commands out. `resourceTypes` scopes a run to the resources of those types it was started on, and suits applications whose grant rules resolve every operation the agent calls to one of those types.

Guarantees: the catalog refuses an agent that names an unknown operation, repeats one, has no operations, has budgets outside fixed bounds, or is `direct` on a command without a UI binding, so every direct write is one a person can make and see. `agentGrant` only narrows: operations within the issuer's grant, resources within the issuer's resources, expiry at the earlier of the issuer's and the wall-time budget, bound to the issuer's principal, workspace and run.

Gaps: the host's run panel does not start a run from a definition; runs there still start from a person's prompt with the issuer's grant. A [trigger](#trigger) starts one under a [standing grant](#standing-grant). A `propose` agent cannot also be resource-scoped, because grant resources match exactly and do not cover the [proposal](#proposal) records it creates. A [trigger](#trigger) chooses its agent's harness by the model requirement; the host's run panel does not. `scaffold add agent` is not implemented.

implemented · `packages/contracts` `packages/runtime` `packages/agents` `packages/adapters`

### Proposal

_A command one caller proposes and another accepts under their own authority._

`proposalOperations` are the module's `proposal.submit`, `accept`, `reject`, `expire`, `list` and `get`, under fixed IDs; `proposalHandlers` serves them over a `proposals` slice in the application's state. A proposal records the operation, its complete input, the rationale, the reported confidence and model, the record it is about and the revisions the proposer read. Who proposed it and the run come from the trusted context. Accepting marks it accepted and continues with its command (see [Command](#command)) as the accepter, checked against those revisions. The application's policy gives each operation its rule, usually resolved from the record the proposal is about, and decides who may see a proposal before lists filter, count and page.

The frame's `proposal-review` registry item lists open proposals with Accept and Reject. The operator registry's attention queue has a `proposal` kind with `proposalChoices` for a one-tap tile at a station.

Guarantees: accepting never widens authority. The proposed command's own rule, grant check and commit recheck apply to the accepter. A caller who may not run it, including a proposer whose grant leaves it out or an accepter demoted after the proposal, is refused. A record changed since the proposer read it conflicts. Either way the acceptance rolls back and the proposal stays open. An expired proposal cannot be accepted. A proposal of an unknown command, of input its schema refuses, or of another proposal operation is refused at submission. A retried accept with the same key returns the same continuation.

Gaps: the framework does not sweep expiry; an application runs `proposal.expire`, as line-station does from a scheduled [trigger](#trigger). A proposal names one command, so a plan of several steps is several proposals accepted one by one. The model identity is reported by the proposer, not verified.

implemented · `packages/contracts` `packages/runtime` `packages/frame` `packages/operator-ui`

### Trigger

_Work that starts on a committed change or a schedule instead of a person's prompt._

`defineTrigger` declares what starts a run (a journal event of one resource type from listed operations, or a schedule slot) and what runs: an [agent definition](#agent-definition) or a deterministic job the server registers. The `automation` plugin checks each trigger against the catalog when it opens and, in a serving host, runs every trigger that has an active [standing grant](#standing-grant) through a run supervisor, so budgets, cancellation and run records are those of an [agent run](#agent-run). An attention item is an event like any other.

Guarantees: one run per matching event or slot, recorded before the next. A failed run becomes an open failure for the grant's issuer and is never retried. A job's commands are keyed by run, operation and input, and the run ID names the grant and the event or slot, so a crash between a commit and its record replays on restart. A trigger whose run calls an operation it reacts to is refused at startup, so a run cannot start itself again. The journal is read as the issuer, so a trigger never sees an event its issuer could not.

Gaps: an agent run repeated after a crash can repeat its writes, because model tool-call IDs are not stable; event triggers suit proposing agents. Triggers are declared in code. Runs do not appear in the host's run panel.

implemented · `plugins/automation`

### Standing grant

_A person's recorded, expiring permission for a trigger to act as them._

`automation.grant.issue` records who enabled a trigger, the operations its runs may call and when it expires (at most 90 days). `renew` extends it and `revoke` ends it. Each run executes as the issuer with a delegation listing only those operations, expiring at the earlier of the grant's expiry and the run's wall-time budget, so the application's policy decides every call as that person at the time of the call.

Guarantees: only a person issues, renews or revokes a grant, and only their own; a run or agent never creates standing authority. A grant never widens the issuer: a role they lost since issuing is refused like any other call of theirs. Revoking or replacing a grant stops future runs. A trigger has at most one active grant.

Gaps: revocation does not interrupt a run already in progress; it finishes within its budget. Grants cover a whole trigger, not individual resources.

implemented · `plugins/automation`

### Input source

_Device input normalized into events and routed to an intent without a model turn._

Scanners are callers too. A wedge, serial, HID or camera scanner, or a rugged Android device's scanner app broadcasting an intent, produces a normalized scan; a configured route turns it into the same command a button or tool call would submit.

Guarantees: sources are registered explicitly. Decoding validates GS1 check digits and AIM symbologies and corrects keyboard-layout mismatch. Routes are site configuration.

Each non-wedge source is declared as a device requirement, so the security manifest lists it.

Gaps: no source has been checked on real hardware. Device access is declared but not mediated. The intent receiver accepts broadcasts from any app unless the profile names a sender permission.

implemented · `packages/devices` `plugins/intent-scanner`

### OS handler

_A declared registration with the operating system, such as a link path, file type, share target, Android intent, shortcut or reply, and where its requests go._

Other applications on the device are callers too: a link clicked in a mail client, a file opened from Finder, text shared from a browser. A module or host component declares what it registers and a target for each request: open a selectable resource, navigate to a screen, prefill a command's form, or hand the request to a composed plugin. Platform registrations (Electron packaging, Expo configuration, the web manifest) are generated from the same declarations, so nothing registers at runtime. The URL scheme comes from the application identity, so content declares paths and never names the product.

A request reaches the frame as a delivery for the session that submitted it. The frame opens the resource through the screen its kind declares, navigates, or fills the command's form and shows where the values came from; a person submits it through the ordinary binding.

Guarantees: composition refuses duplicate ids, two handlers on one path shape, file extension or media type, a template naming a field the request does not carry, a prefill whose command has no UI binding or whose keys are not input fields, and payload limits outside 1 byte to 1 MiB of text or 256 MiB of blob. Matching accepts only the application's own scheme and configured verified hosts, validates parameters with the handler's schema, and refuses credentials, dot segments and encoded slashes. An unsolicited request never commits: it only opens a resource the caller may read (checked when queued and again when taken), navigates or prefills. Deliveries go only to the submitting session and expire after two minutes. Requests are audited by digest and reason code, never content. The security manifest lists every handler as local ingress.

Gaps: the desktop adapter submits links and files, a blob file uploaded to the blob store first, but nothing has been received from a real OS yet: macOS reads the scheme and document types only from a packaged bundle, and the Linux and Windows `dir` builds register no file types. The browser adapter submits `?os=` landings and launch-queue files the same way, and the web manifest declares the handlers, but no installed web app has registered them yet. A staged upload lives in the authority's memory, so a prefill that waits across a restart loses its attachment and the person must open the file again. No mobile adapter exists. Share, intent, shortcut and reply handlers wait for their plugins.

partial · `packages/contracts` `packages/shell` `plugins/os` `packages/frame` `plugins/compliance` `apps/desktop` `examples/project-tasks`

### OS action

_A declared request to the operating system to open a URL, reveal or open a file, share, notify or send an Android intent, with the data classes it carries._

The outbound counterpart of an OS handler. An application can only ask the OS for what it declared, and the URL or path is built from the declaration's template, never from a caller's string, so no generic URL-opening method exists for an agent or a page. A notify action can carry an outbox target, so a command's effect becomes a notification.

Guarantees: an open action is `https:`, `mailto:` or `tel:` with a fixed host and no credentials, query or fragment, and its placeholders must be declared parameters; values are encoded into their own path segment and the result must keep the declared host. A file path stays below a configured root. A notify action's replies must name declared reply handlers, and one that carries an outbox target must queue while offline. An action runs through the adapter attached for the caller, or returns to a page to run while it has user activation. The security manifest lists each action with its data classes; the audit log records only the URL's origin.

The desktop window opens a URL only when a declared open action builds it; the provider sign-in is the `openai.authorize` action of the OpenAI host component, so its whole rule is that action's parameter schema.

Gaps: no action has been performed on a real OS yet. Without the OS plugin, the desktop opens a declared URL itself and nothing is audited. No plugin declares the root directory settings that reveal and open-file need, and notify waits for its plugin.

partial · `packages/contracts` `packages/shell` `plugins/os` `plugins/compliance` `packages/agents` `apps/desktop` `packages/frame`

### Shell port

_The kernel port that receives OS requests and performs OS actions; its default refuses both._

The kernel has no OS integration of its own. The OS plugin provides the port; the host exposes it over HTTP, so Electron main and a browser page submit requests with their session's bearer, and an adapter in another process attaches by long-polling for instructions. A platform that runs the OS in-process, as mobile will, supplies its adapter on the host platform.

Guarantees: without a provider every call is `UNAVAILABLE`, and two providers refuse startup. A request is attributed to the submitting session and never sets the principal, workspace or grant. A relayed instruction can be answered only by the session that took it, counts as not performed after 30 seconds, and the relay detaches when its session is revoked or stops polling. Startup refuses a declared kind that no composed plugin serves.

The desktop shell adapter (`createDesktopShell`) holds the platform-neutral part: buffering until the authority is reachable, reading only declared files and uploading a blob payload before submitting it, the relay loop and the open check. Electron main supplies the OS calls and the loopback client.

A browser page attaches no adapter: it runs an open or share instruction itself (`runOsAction`).

Gaps: the embedded authority has no shell routes. Only HTTP adapters can attach on the Bun host. No Expo adapter exists yet.

partial · `packages/kernel` `packages/host` `packages/adapters` `packages/shell` `plugins/os` `apps/desktop`

### UI registry

_Reusable screen parts published as shadcn registries over stock shadcn primitives._

Specialized interfaces are cheap only if their parts are shared. Apps pull registry items with `shadcn add` and own the copied source, while trust-relevant behavior stays in versioned bindings. A plugin that brings a screen ships it as its own registry, as the compliance plugin does with `compliance-screen`. The native registry carries the same point-of-work rules to React Native on Uniwind: `hold-button`, `status-pill` and `list-row`.

Guarantees: no shadcn primitive is forked; sizing comes from tokens and `cva` variants. The registry manifest is generated and drift-checked. Operator items follow the point-of-work rules: glove-sized targets, hold-to-confirm for consequential actions, state as icon plus text. The app shell exports `NavigationCount`, `SidebarSection` and `SidebarLink` for the slots; `status-strip` adds `SignalBanner`, the one signal readable from the machine; `operator-station` lays out a full-window station (dark header with seat control, machine banner, task panel beside attention, history footer) with `OperatorPanel` for the task.

`collection-screen` gives any collection a list screen (server-paged table, search when the list takes one, create form) and a record screen (fields and an update form), with a `sync` field shown as delivery state. An application replaces them one route at a time.

Gaps: no scratch-app `shadcn add` acceptance test.

implemented · `packages/operator-ui` `packages/frame` `packages/frame-native` `plugins/compliance`

## Integrations: systems that keep their own records

### Outbox effect

_A durable intent to change another system, committed with the command that causes it._

The outbox extends the write side past the authority's own transaction without pretending to a distributed one. The command records what should happen elsewhere; delivery happens later, outside any transaction, and its outcome comes back as another command.

Guarantees: the effect commits with its command or not at all. Its ID derives from the receipt, so a replay never enqueues twice, and it doubles as the target's idempotency key. It is settled exactly once. A held effect waits for a person and returns to delivery only through a reconciliation command. `ctx.cancelEffect` withdraws an effect inside a domain command only while no worker ever claimed it, because after a claim the target may already have it. The enqueuing command's input is kept with the effect for the dispatch recheck and never leaves the kernel: dispatchers, ports and handlers get the effect without it. `effectPhase` names where an effect is (`queued`, `claimed`, `retrying`, `upstream`, `held`, `accepted`, `rejected`, `cancelled`); see [reconciliation](#reconciliation).

implemented · `packages/runtime`

### Connector

_The port that delivers effects to one target and looks up their outcome._

A connector is the only code that talks to an external system. The same port covers an ERP API, a file drop and legacy station software that can only be reached through its screen.

Guarantees: a target declares idempotent delivery or implements a lookup consulted before every send. A business rejection is data, never retried. An outcome the connector cannot establish is reported as uncertain, never guessed. A target that acknowledges now and decides later returns `pending` from `deliver` and from `lookup` until it decides. A port may also implement `search`, which a [remote query](#remote-query) calls with the access it resolved for the caller; delivery never uses it.

implemented · `packages/integration` `packages/station`

### Dispatcher

_The worker that delivers pending effects and settles them under a narrow integration principal._

Guarantees: at-least-once delivery with backoff and journaled attempts, so screens can show retrying. Each delivery runs under a [worker claim](#worker-claims). Before an effect's first claim the person who committed it is authorized again on the current state (the `dispatch` phase), and a denial holds the effect instead of sending it; later claims are not rechecked, so a result already on its way is recorded after the actor lost access, and journal visibility still hides it from them. An acknowledged effect (`upstream`) is never delivered again: its lookup is polled until the target decides, a lookup that loses it holds it, and `drain` counts it as delivered. The integration grant can only settle, sync and read status. `drain` reports whether anything is still pending, and its deadline aborts a delivery in flight. `drainTargets` drains every dispatcher a host composed and accounts for the whole outbox by target, so a target with work but no dispatcher in this process is reported as not deliverable instead of being left out. An uncertain outcome is recorded and held even when shutdown interrupts the pass.

`createTargetIntegration` builds one target's connector, integration context, dispatcher and inbound sync from a port, and `connectTarget` does the same from a [target](#target) declaration, so an application's `connect` declares targets instead of wiring workers.

Gaps: the recheck asks the policy about the actor's role, not the command's preconditions; an imperative policy that ignores the phase decides it in full. A host restart waits out the lease of effects the previous process had claimed.

implemented · `packages/integration`

### Inbound sync

_Imports upstream changes as ordinary commands._

Other systems change too. Inbound sync brings those changes in through the write side, so they are authorized, journaled and visible like any local change.

Guarantees: the watermark is part of the command's input, so a stale page conflicts and two pullers cannot apply it twice. With `versions`, a target keeps the last applied upstream version of each record in state and drops items that are not newer before the application sees them, so a feed that delivers an older version after a newer one cannot roll a record back.

Gaps: versions are numbers; a target with unordered version tags (ETags) needs its own mapping to an order.

implemented · `packages/integration`

### Target

_A system of record declared once: its settle, feed and status operations, its principal's grant and its policy lane._

Every application that forwards to another system wrote the same three operations by hand: settle an effect's outcome, apply a feed batch over a watermark, and report synchronization status. `defineTarget` (browser-safe) declares them from the target name, the records it settles, the feed's item schema and side lists, and the application's own status fields. `targetHandlers` implements them; the application supplies how an outcome changes the forwarded record (`settleDelivery` for the usual record with `effectId`, `sync`, `sorRef` and `rejection`), how a batch changes local state and its scoped status counts. `targetContext`, `targetLane` and `targetRules` give the integration principal's grant, its policy lane and the rules for the three operations, and `connectTarget` wires the declaration to a port. crm-capture, quality-inspection and line-station use it.

Guarantees: settle takes the dispatcher's fencing token (`fence`) and refuses one older than the effect's current [claim](#worker-claims). It checks inside the transaction that the effect exists and belongs to the calling principal's target (by default the declared target; line-station overrides this so each station bridge settles its own screen target), then records the outcome on the forwarded record and declares it changed. A forwarded record that is missing or forwarded another effect is `NOT_FOUND`, so an outcome never lands on the wrong record. A feed batch whose `from` is not the stored watermark conflicts before anything is applied. The grant and the lane name exactly the target's operations; settle and sync are closed to every other caller, and status is open and scoped by the application's handler.

Gaps: one feed per target. The status counts are still written by each application, because what a caller may count depends on its scope.

implemented · `packages/contracts` `packages/integration`

### Remote query

_A query that reads another system at the moment someone asks, with the caller's own access, and stores nothing._

Outbox effects and inbound sync keep local records in step with a system of record, but neither lets a person or agent ask the system of record something now. A remote query does: the runtime calls the target's source between two read snapshots, outside any transaction. The handler only builds the request and maps what comes back, both without I/O. What the caller keeps from a result is a separate command.

Guarantees:

- The order is: authorize; build the request; call the source with a deadline and the caller's signal; authorize again in a fresh snapshot; map, project and validate; authorize once more. A denied caller never reaches the source, and a revocation during the call drops the result.
- The source receives the execution context, so it resolves the caller's credential, or the delegator's for an agent run. A service credential is used only under `caller-or-service`; a service answer to a `caller` query is refused.
- An unreachable, slow or missing source is `source.status: 'unavailable'` with a caller-safe message. `FORBIDDEN` and cancellation propagate.
- Results carry target, identity and fetch time and are never stored. The audit records target, status, identity, item count and whether more pages exist, never the query, the cursor or the items.
- Paging belongs to the source. The caller passes back the opaque `next` of the previous page as `cursor`, and the runtime returns the source's next cursor untouched. A page can be short or empty after scoping, so only a missing `next` ends the list. A source binds each cursor to the search and the credential that produced it, and refuses it otherwise, so a cursor never widens what a caller reads.

Gaps: proven on one example (two providers). That a source binds its cursors is a port contract, checked only by the example's fake. Credentials are resolved by the application's `CallerCredentials`; no vault adapter ships for it yet.

partial · `packages/contracts` `packages/runtime` `packages/integration` `packages/host` `packages/react` `examples/crm-capture`

### Data provider

_One declaration of what a system of record can be searched for, which becomes ordinary catalog entries for every surface._

A data provider names a target, its identity rule, a query schema and an item schema. `defineDataProvider` turns that into `<id>.search` and `<id>.lookup` remote queries, so the same provider serves a screen through TanStack Query, an agent through MCP, a script through the CLI and HTTP. `implementDataProvider` supplies the item mapper, where local state and scoping apply; `createRemoteSource` adapts a port's `search` and resolves credentials.

Guarantees: capability IDs and inferred types stay literal. Both queries need `search` permission on the provider's resource type and declare `remote`, so composition requires a destination that reads the target. Search takes the provider's query plus an optional `cursor`, which a provider cannot redefine. Lookup takes only an external ID.

Gaps: proven on one example with two providers. Adoption is domain code and is not generated.

partial · `packages/contracts` `packages/integration` `examples/crm-capture`

### Observation

_A reading from a source that cannot be queried, submitted through an ingest command._

Observation is the inbound counterpart for systems with no feed, such as a vendor HMI read by accessibility, OCR or a local vision model. The observer never writes storage; it submits readings like any caller.

Guarantees: each reading carries its source, model identity and digest, frame digest, time and confidence. It becomes current only after it is stable across consecutive reads. A low-confidence reading becomes an attention item for a person. Unchanged content is resubmitted at most once per heartbeat window, and each submission's idempotency key fingerprints its exact payload. A vision endpoint never follows a redirect, so screenshots reach only the validated host, and a perception worker that exits is restarted with a fresh handshake.

Gaps: implemented for screens only; promote out of `packages/station` when a second kind of source needs it.

The station's vision endpoints and perception worker are declared requirements; a site binds a vision service or the observer degrades.

implemented · `packages/station`

### Gated actuator

_Lets a model propose screen actions while deterministic code executes and verifies them._

This is how a computer-use model can operate legacy software without becoming a privileged caller. It sits inside a connector, behind the outbox. A driver resolves targets or proposes actions; the controller decides.

Guarantees: the controller performs every action itself, after a gate covering the expected screen (verified before every click, type and key), forbidden regions, the allowed set, step budget, timeout, bridge mode and seat (recorded state without expiry). Acceptance requires a matching readback on as many consecutive views as the fields' `stableReads` declare; convergence, preconditions and lookup use the same standard. An interrupted procedure that is not declared rerunnable is held, never re-run.

Gaps: no live computer-use model driver; no VNC, RDP, KVM or UI Automation transport.

implemented · `packages/station`

### Reconciliation

_A tracked state and procedure for outcomes no one can establish automatically._

`effectPhase` derives one state from an effect's record, and the outbox allows only these transitions: claim (queued, retrying or upstream to claimed, or to held when the dispatch recheck denies), attempt (claimed to retrying, upstream or held), settle (to accepted or rejected), release (held to queued) and cancel (queued to cancelled). An effect enters `held` when its outcome is uncertain, when a target loses an effect it acknowledged, or when its actor lost the right to send it. Only a domain command leaves `held`: settle when the target did apply it or refused it, release when it did not.

Guarantees: nothing leaves `held` by retrying or by a lease running out. A release clears the acknowledgement, so the effect is delivered again from the start.

Gaps: the phases cover outbox effects only. A reconciliation query across targets (what the target holds against what the outbox believes) is not built, and no screen lists held effects generically; each application shows its own.

partial · `packages/runtime` `packages/integration`

### Worker claims

_Attempt identities, expirations and fencing tokens so a stale worker cannot overwrite a newer outcome._

A dispatcher claims each effect (`claimEffect`) before delivering it. The claim names the worker, expires after its lease and carries a fencing token that grows with every claim. Every attempt the worker records, and every settlement through a `defineTarget` settle command, carries the token.

Guarantees: two live workers cannot claim one effect. Once another worker claimed after a lease lapsed, the earlier worker's attempts and settlements fail with CONFLICT and change nothing; what it saw is kept in the audit log as a denied `effect.attempted` record (`SUPERSEDED`). A lapsed claim is not taken as proof that nothing happened: the next worker looks the effect up first when the target is not idempotent.

Gaps: settlement through a hand-written settle command is fenced only when it passes the token. Leases use the application clock, so a frozen test clock never lets one lapse.

implemented · `packages/runtime` `packages/integration`

## Trust, configuration and proof

### Credential vault

_The port for provider secrets._

Provider credentials pay for inference; they never grant workspace access. The vault keeps them in the operating system's store.

Guarantees: fails closed when the store is unavailable. Secrets never reach browser state, domain data, model context or run logs, and are never discovered or reused implicitly. Account connections (`OidcAccountConnection`, the ChatGPT account) serialize credential writes, so a logout cannot be undone by a sign-in or refresh already in flight.

implemented · `packages/agents`

### Requirement declaration

_What a module or host component needs outside the process, as data: network destinations, devices and child processes._

Security teams admit software when they can see what it talks to and what data leaves. Declarations make that a property of the catalog. Each destination names its purpose, scope, protocol, data classes, availability and offline behavior, and the generated manifest, data flows and SBOM show every change to reviewers.

Guarantees: declarations are browser-safe data, composed with their owners. Composition rejects duplicate IDs, a process that names an undeclared destination, an outbox target that no destination carries or whose destination does not queue offline, and a remote query whose target no destination `reads`. The security manifest lists each operation that leaves the host with its path, `outbox` or `remote-read`. A capability's input is logged in plain text only for the fields its `audit.fields` names.

implemented · `packages/contracts`

### Site policy

_Deployment data that binds declared destinations to addresses and sets a hardening floor._

What a site permits is configuration, like everything else that differs per site. Without a policy the application is isolated: loopback only, outbox targets queue, providers report unavailable.

Guarantees: bindings must name declared destinations and match their protocol, host and port. In connected mode a required destination is bound or explicitly disabled, and every closed destination lists its offline consequence. The `desktop-local`, `sandbox` and `zero-trust` profiles are floors on plain HTTP, ingress (loopback or mTLS), identity, grant lifetime and audit mode; `site check` and startup report the same findings, and the site plugin refuses to start below its floor. A policy that asks for something no composed plugin enforces refuses to start. Certificate files are referenced by path and must be readable.

Gaps: `external` identity refuses to start because no workforce identity adapter exists. No certificate issuance or rotation.

Provided by the `site` [host plugin](#host-plugin), which also enforces the identity floor.

implemented · `packages/egress` `plugins/site`

### Egress guard

_The only path from server code, and from declared child processes, to the network._

Guarantees: a destination-scoped fetch allows only the bound scheme, host and port, rechecks every redirect hop, checks DNS answers against bound addresses, applies CA bundles and certificate pins, and caps response size and time. Provider SDKs get a fetch routed by origin, TCP transports a scoped socket, and declared children a loopback CONNECT proxy limited to their declared destinations. Every decision is logged; a refusal is an `UNAVAILABLE` error. `check:boundaries` fails on direct network or process APIs in server code outside a reviewed exemption list, and on an exemption that no longer matches.

Gaps: an in-process control, not an isolation boundary. A child that ignores proxy settings, or a compromised process, is contained only once the exported OS rules are applied.

Provided as the network port by the `network` [host plugin](#host-plugin), together with mTLS ingress when the policy selects it.

implemented · `packages/egress` `plugins/network` `scripts`

### Event log

_An injected, hash-chained record of every command, query, denial, outbox transition, sync pass, connection and run._

The journal tells views what changed; the event log tells an auditor who did what, through which surface, and what was refused. Injecting the port makes every layer observable without code in handlers.

Guarantees: events carry the actor and channel, operation, a safe reason code, correlation IDs and an input digest; input values appear only for allow-listed fields. `command.accepted` is appended inside the transaction, so in required mode a failed append rolls the command back, and startup resolves accepted commands a crash left open. The JSONL adapter chains SHA-256 across rotated segments, syncs every append, writes 0600 files and admits one writer per directory. The verifier reports edits, gaps and truncated segments. Forwarding sends RFC 5424 syslog through the network port.

Gaps: removing the newest events is detectable only against an anchor or a forwarded copy. No off-host collector has been exercised.

Provided as the event-log port by the `audit` [host plugin](#host-plugin), which also attests the build and recovers after a crash at startup.

implemented · `packages/contracts` `packages/runtime` `packages/event-log` `plugins/audit`

### Execution host

_An isolation boundary and credential broker for tools an agent runs._

The egress guard confines declared children to their destinations, launchers fix an embedded agent's grant, and the hardening exports describe an OS sandbox for the service. The network plugin's `network export` renders the site policy as default-deny rules for nftables, Windows Firewall, systemd, Kubernetes, Compose and JSON; each carries the policy digest and lists what it could not enforce.

Gaps: no isolation backend applies those rules, and there is no credential broker. Exports are compared as text, not loaded into a firewall or cluster.

partial · `packages/egress` `plugins/network`

### Profile

_Versioned, schema-validated data describing one site._

A station's screens, fields and procedures, a scanner's behavior and scan routes are data, so a new site is configuration rather than a fork.

Guarantees: validation rejects procedure steps that target forbidden regions or unknown fields.

implemented · `packages/station` `packages/devices`

### Configuration module

_A reusable capability module that makes site configuration an ordinary operation._

Configuration is itself part of the catalog, so a supervisor's screen, a CLI script and an agent change it the same way, under policy and revisions.

implemented · `packages/devices`

### Golden check

_Replays labeled inputs through a profile and its extractors, as a separate procedure run before a profile or model change is used._

Guarantees: reports per-field accuracy and confidence and fails on a confident misread.

Gaps: the current golden set exercises recorded expectations, not a model. Activation does not require a passing report: nothing ties a running profile to a golden result, so the check is a procedure, not a gate.

implemented · `packages/station`

### Compliance bundle

_The evidence an auditor checks, generated from the catalog and site policy and re-checked while the application runs._

Guarantees: the security manifest, data flows, control mapping (ISO/IEC 27001 Annex A, NIST SP 800-53 and CSF, IEC 62443-4-2) and CycloneDX SBOM are deterministic and drift-checked. Every control names tests, artifacts and event kinds that exist. A posture monitor re-verifies the log and records `posture.checked`. Through the `compliance` [host plugin](#host-plugin), listed auditors read posture and the log with ordinary authorized queries and a screen, and an offline report works against a copied log.

Gaps: control mappings are indicative, not a certification. The SBOM covers the whole lockfile, so every application's bill lists the desktop, web and mobile toolchains (Electron, Vite, Expo, React Native) as `required`, not only what that application ships on one target.

implemented · `plugins/compliance` `packages/host`

### Behavioral scenario

_A reusable test of one capability's allowed, denied, stale, replayed and visible behavior._

Scenarios are what prove the core idea: the same test runs through every surface and must produce the same outcome.

Guarantees: results and structured errors are compared across drivers.

implemented · `packages/testing`

### Scaffold

_Exports the framework, the starter and content as a standalone application, and generates new applications and their parts._

`--example <name>` exports one example as the hosted application and leaves the others, their reference sets, root dependencies and lockfile entries out. `new` exports no example and generates one application instead: manifest, application and screens entrypoints, one collection with default screens, the site, network, audit and compliance plugins, a cross-surface conformance test, a UI-binding test and a browser test. `add collection|capability|target` generates a part's contract, handlers, policy rule, screens and behavioral test and inserts them at the application's `// scaffold:<list>` markers.

Guarantees: a versioned file-hash manifest; no credentials, workspace data or build output; never overwrites an existing target. A single-example export and a generated application each install frozen and pass their own checks. `add` writes nothing unless every file is produced, never overwrites a file, and edits existing code only at a marker.

Gaps: framework packages are unpublished, so an export vendors `packages/*` instead of depending on published versions. An export without the reference examples still carries their boundary and size exemptions. No `add agent` yet.

implemented · `packages/scaffold`

### Task package

_A signed, versioned package with declared requirements, staged activation and rollback._

proposed

## Adding or changing a primitive

1. Check that it is a concept, not an adapter. An adapter belongs with its port.
2. Check that it is domain-neutral. If only one example needs it, keep it in that example.
3. Prefer extending a primitive or extracting existing code over writing a new one.
4. Update the entry in the same change as the code, including its guarantees and gaps, and link it from the README of every location it names.
5. Change the status only with evidence in the [implementation ledger](implementation-status.md).
