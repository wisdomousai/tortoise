# Architecture

Tortoise separates application code from the host that executes it. The application declares its operations in a browser-safe contract. Server handlers implement those operations against the application's state, and its screens call the instance through a typed client. The host composes these contributions and supplies the facilities required by the execution environment.

An application defines a process. An instance is that application opened on a workspace. The workspace contains the records and execution metadata for that instance. A serving host owns the workspace while it is open and accepts requests through its configured channels. Each request reaches the runtime with context supplied by the host.

## Application entrypoints

The starter loads these entrypoints from the application selected in `app.config.json`:

| Entrypoint | Responsibility | Execution environment |
| --- | --- | --- |
| `manifest.ts` | Application identity and declarations, including the modules and composed features or plugins | Browser and host |
| `application.ts` | `defineApplication`, state initialization and upgrade, handlers, application policy and connections | Host |
| `screens.tsx` | `defineScreens`, routes, navigation and screen contributions | Browser |

Contracts must be importable without loading server handlers or provider code. The catalog composes the contracts and validates their references before the host opens the instance. It also supplies the operation descriptions used by generated interfaces.

Application handlers run under an `ExecutionContext` containing the trusted caller identity. A capability's input schema cannot set that context. A screen has no direct access to storage; its reads and writes go through the same runtime entrypoints used by other callers. The [interaction contract](interaction-contract.md) specifies the channel mappings and request envelopes.

## Layers

| Location | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `packages/*` | Domain-neutral framework | Framework packages |
| `workstations/*` | Workstation screen bridge and shared-terminal sign-in | Framework |
| `plugins/*` | Cross-cutting host facilities | Framework and explicitly required plugins |
| `apps/*` | Starter host wrappers | Framework |
| `showcase/examples/*`, `showcase/patterns/*` | Hypothetical demonstration applications | Framework, workstations and plugins |
| `sdks/*` | Implementations of the driver protocol | No application dependency |

The framework does not import application content. Domain code remains in the application that owns it. Workstation packages have their own layer because their platform-specific behavior must not become a dependency of every host.

A file in `apps/web/src` overrides the frame file at the same path. General frame behavior belongs in the framework package so applications exported from the starter can receive later framework changes.

<OverviewView view="layers" />

## Instances and hosts

The kernel checks requirements, opens the plugins and then opens storage and blobs. It runs plugin `ready` hooks before starting integration workers. A startup failure closes completed resources in reverse order. A serving host starts the serving lifecycle after it begins listening. The startup sequence is implemented in `packages/kernel/src/instance.ts`.

| Platform | Workspace storage | Ownership |
| --- | --- | --- |
| Bun host | SQLite | Exclusive workspace lock |
| Hosted Bun instance | Postgres | Database lease and fencing token |
| Mobile | SQLite snapshot | Exclusive transaction |

The local Bun host can open sockets and child processes through its ports. The mobile platform does not supply those facilities. Platform support must satisfy the declared requirements of the composed application.

### Embedded and attached modes

In attached mode the CLI or MCP bridge reads `.workspace/.connection.json` and sends requests to a serving host. The desktop window can attach to that host as well. Attached callers act under the session in the connection file.

In embedded mode the CLI opens the workspace in its own process. `bun run cli mcp --embedded` serves MCP this way; a CLI operation accepts `--embedded` too. A grant file can narrow access. Opening a workspace already owned by a serving host fails with `CONFLICT`.

### Channels and identity

The HTTP adapter obtains identity from a browser session or a process bearer credential. MCP and CLI callers attach through the connection file or open an embedded instance under their configured grant. The host validates this context before invoking the runtime. Caller-controlled fields do not establish identity.

Live-event access uses the caller's current read policy. Event authorization remains inside the storage read boundary, including delivery enqueueing. An adapter must preserve this boundary when it forwards events.

## Storage

The storage port provides a read snapshot and an atomic transaction scoped to a workspace. A successful command commits its state changes together with execution metadata. A failed transaction commits none of those changes. [Operations and state](capability-authoring.md) describes the journal and retained command results.

Memory storage isolates copies for tests. SQLite and Postgres store keyed rows and write the rows changed by a commit. The snapshot adapter stores one document for the mobile host. Queries currently load workspace state even when storage uses separate record rows.

A replacement storage adapter must commit revisions, retained command results, journal entries and outbox effects in the same transaction as state. It must pass `storageConformance` from `@tortoise/testing`. The [adapters package](../packages/adapters/README.md) documents the reference implementations. Hosted ownership adds a lease check to Postgres commits, as specified in [Deployment and operation](hosting.md#workspace-lease-and-fence).

## Host plugins

A host plugin contributes a feature with host lifecycle hooks and optional port implementations. An application lists the plugin manifest in its browser-safe manifest and the corresponding plugin in its server definition. Composition requires the lists to agree and places a dependency before the plugin that requires it.

The kernel resolves each port to one provider. An application that omits a provider receives the default behavior below.

| Port | Default | Provider |
| --- | --- | --- |
| Network | Refuse external destinations | `plugins/network` |
| Ingress | Loopback | `plugins/network` |
| Identity | Local-user identity | `plugins/deployment` |
| Audit log | No persistent audit log | `plugins/audit` |
| Shell | No OS integration | `plugins/os` |
| Processes | Refuse child processes | `plugins/process` |
| Folders | No exchange folders | `plugins/deployment` |

A declaration alone does not grant access to an external resource. The deployment policy binds the declaration to its address or local resource. [Security and compliance](security-and-compliance.md) specifies enforcement and its limits.

<OverviewView view="ports" />

### Features and host plugins

A feature contributes reusable application behavior under its own operation namespace and state slice. The application supplies an access view for the feature's policy. A plugin extends this composition model with host ports and lifecycle settings. Composition rejects a duplicate identifier, an operation outside its unit's namespace, conflicting port providers or an undeclared setting. Required ports must have providers.

### Lifecycle

| Hook | Execution point |
| --- | --- |
| `open` | Before storage opens; it can refuse startup |
| `ready` | Before the instance accepts requests |
| `start` | After a serving host listens; omitted in embedded CLI and MCP |
| `close` | During shutdown, in reverse opening order |

### Telemetry

The telemetry plugin derives metrics and spans from runtime audit events and outbox state. Its export contains identifiers, operation states and measurements; it excludes record contents and principals. Handlers do not need to call a telemetry API. Configuration belongs to the [telemetry plugin](../plugins/telemetry/README.md).

## Extension contracts

A new channel adapter maps its requests to the runtime's raw invocation and query entrypoints. It must preserve the shared result envelope and revision semantics. Identity comes from the host's trusted context, and events require current authorization at delivery.

Storage and authorization are ports as well. Replacing a port requires preserving its contract and running its conformance checks. An authorization adapter must implement object and field checks together with row filtering before pagination; it must reject policy constructs it cannot enforce. Provider-specific dependencies remain inside their adapters.

The [host-plugin skill](../packages/host/skills/write-host-plugin/SKILL.md) describes plugin composition. The [concept reference](primitives.md) identifies the implementation that owns each extension point.
