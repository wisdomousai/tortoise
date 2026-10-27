# Glossary

Rules for the entries:

- One term per concept. The term on this page is the one every page uses.
- A term that has several meanings in everyday use is qualified: "hardening profile", "station profile", "OS user".
- Code identifiers are not terms. A page names the concept and then the identifier in backticks when the sentence points at that identifier.
- A `Do not use:` line lists the words the term replaces. An entry with a qualifier in parentheses, such as `page (for a screen)`, bans only that sense, because the bare word has other correct senses.
- Protocol, file-format and product names keep their own form. These abbreviations also stay abbreviated:
  - interfaces and protocols: CLI, MCP, API, UI, HTTP, SSE, TLS, mTLS, OIDC, PKCE, OPC UA, MQTT, OTLP;
  - data and identifiers: JSON, SQL, URL, ID, PIN, GS1;
  - systems: OS, SDK, ERP, MES, CRM, EAM, QMS, PLC, HMI, MDM.

## Terms

### Adapter

An implementation of a framework port, such as the SQLite storage adapter or the CASL authorization adapter. Lives in [`packages/adapters`](../packages/adapters/README.md). A harness adapter is an adapter of the harness port.

Do not use: driver (for a port implementation), provider (for a port implementation).

### Agent definition

A named agent in the catalog: its instructions, the capabilities it may call, the resource types it works on, its model requirement, its output mode and its budgets. Declared with `defineAgent`. Lives in [`packages/contracts`](../packages/contracts/README.md) and [`packages/runtime`](../packages/runtime/README.md).

### Agent run

One run of an agent, acting as one more caller on the catalog under a grant narrowed from its issuer's. Lives in [`packages/agents`](../packages/agents/README.md); explained in [agents](agents.md).

Do not use: session (for an agent run), conversation (for an agent run), LLM run.

### Agent scenario

A test of an agent definition: a task, fixture state and the commits, approval requests and refusals expected. It judges receipts, not the model's text. Lives in [`packages/testing`](../packages/testing/README.md).

### Application

One unit of content that a host runs: a browser-safe manifest, an application definition and screens, with their tests. The examples under `examples/` are applications. Explained in [architecture](architecture.md#application-entrypoints).

Do not use: app (in prose; `app` stays in file names and commands).

### Application definition

The server entrypoint of an application, declared with `defineApplication` from [`packages/kernel`](../packages/kernel/README.md). It holds the manifest, state and its migrations, handlers, authorization and services. It also holds remote sources, plugins and the connections to systems of record. It is trusted code that runs with the host's privileges.

Do not use: server definition, definition file.

### Approval dataset

The approval requests people approved, rejected or let expire, exported as training data. It holds only approval requests the exporting caller may see, and redaction is applied before its digest. A model entry names the dataset by that digest. Lives in [`packages/runtime`](../packages/runtime/README.md).

### Approval request

A command that one caller, usually an agent run, asks a person to approve before it runs. Approving runs the command once, in the same transaction, with the approver's own grants and policy; a refusal or conflict leaves the request pending. A requesting agent cannot commit. A request is pending, approved, rejected or expired. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [agents](agents.md).

Do not use: proposal, suggestion (for an approval request).

### Attached mode

Running a CLI, MCP bridge, desktop window or phone against an instance that another process owns, through a session that instance issued. The opposite of embedded mode. Explained in [architecture](architecture.md#instances-and-hosts).

Do not use: remote mode.

### Audit log

The hash-chained, tamper-evident record of commands, queries, denials, outbox transitions, sync passes, connections and agent runs. The composition's default port keeps no log; `plugins/audit` provides one in the deployment policy's audit mode. In required mode, a command whose accepted record cannot be appended inside its transaction rolls back. The code names are `packages/event-log`, `EventLogPort` and the policy key `eventLog`. Lives in [`plugins/audit`](../plugins/audit/README.md); explained in [security and compliance](security-and-compliance.md#audit-log).

Do not use: event log, audit trail, log (alone, for the audit log).

### Behavioral scenario

A reusable test of one capability: permitted and denied access, a stale revision, a replayed idempotency key, and the change visible to another caller. Lives in [`packages/testing`](../packages/testing/README.md).

### Blob

Content-addressed bytes, such as a photo or a document, that a command references from a resource. The blob store is the port that keeps them. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: file upload (for a blob), asset (for a blob).

### Bridge mode

How far a screen bridge or a driver bridge may act. `monitor-only` never acts, `assist` runs only actions of hazard class `none`, and `actuate` runs every declared action. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) and [`plugins/connector-driver`](../plugins/connector-driver/README.md); explained in [operator workstations](operator-workstations.md).

### Caller

The source of a command or query: a person at a screen, an agent run, a script, a trigger, a device or the dispatcher. Every caller uses the same catalog with the same validation and authorization.

Do not use: actor, requester, client (for a caller), invoker.

### Capability

A command or query declared once as data with `defineCapability`: its operation ID, input and output schemas, permission and UI binding. The catalog is the composed set. Lives in [`packages/contracts`](../packages/contracts/README.md); explained in [capability authoring](capability-authoring.md).

Do not use: operation (alone, for a capability; "operation ID" is the identifier), tool (for a capability; a tool is the MCP projection), action (for a capability).

### Catalog

The composed, validated description of everything an application can do. It holds the capabilities, requirement declarations, workflows, agent definitions, and OS handlers and actions. Every surface and generator reads it. Lives in [`packages/contracts`](../packages/contracts/README.md).

Do not use: registry (for the catalog), manifest (for the catalog), API surface.

### Channel

The surface that carried a request, as recorded in the execution context and in audit records: `direct`, `http`, `mcp`, `cli`, `embedded`, `integration`, `harness`, `host` or `shell`. The host adapter sets it; a caller cannot. Lives in [`packages/contracts`](../packages/contracts/README.md).

### Collection

A typed set of records a module keeps in its state slice, with generated get and list queries. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: table (for a collection), entity set.

### Command

An authorized write, submitted the same way by every caller. It commits state, revisions, its receipt, journal entries and outbox effects in one transaction, or fails. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [state and reactivity](state-and-reactivity.md).

Do not use: write operation, action (for a command).

### Compensation

The command a declared workflow step names to undo it. When a later step fails for good, or a person cancels the instance, the compensations of the completed steps run in reverse order, as the starter. Its input is read when its step completes. Lives in [`plugins/workflows`](../plugins/workflows/README.md).

Do not use: rollback (for a compensation), undo step.

### Compliance bundle

The evidence an auditor checks: the security manifest and data flows, a control mapping, a CycloneDX SBOM and a posture monitor. It is generated from the catalog and the deployment policy and re-checked while the application runs. Lives in [`plugins/compliance`](../plugins/compliance/README.md).

Do not use: evidence pack, audit bundle, report (alone).

### Composition

The portable layer that composes an application and its plugins, resolves the host ports and opens one instance. It uses no Node, Bun or React Native API. Lives in [`packages/kernel`](../packages/kernel/README.md).

Do not use: kernel (for the composition), core (for the composition), bootstrapper, composition root.

### Connection file

A private JSON file with a loopback endpoint and a bearer token, which the host writes as `.connection.json` in the workspace directory. The CLI and the MCP bridge attach with it. With a grant file, `serve` can write a second connection file bound to a delegated session. Lives in [`packages/adapters`](../packages/adapters/README.md) and [`packages/host`](../packages/host/README.md).

### Connector

An implementation of the system-of-record port for one target. It delivers effects, looks up earlier deliveries and, where the target supports it, pulls changes and answers searches. Ready-made connectors live in `plugins/connector-*`; the port lives in [`packages/integration`](../packages/integration/README.md). Explained in [systems of record](systems-of-record.md).

Do not use: integration (for a connector), adapter (for a connector), bridge (for a connector).

### Container

A work order, plant, workstation or other unit that people hold roles in. Membership is per container. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [authorization](authorization.md).

Do not use: scope (for a container).

### Continuation

A command a handler asks for with `continueWith`, run after the handler's frame as a [nested invocation](#nested-invocation) in the same transaction under the same context. The caller lists it in `invokes`, and the nesting limits apply. It has no idempotency key of its own; the top-level receipt covers it. A refusal rolls back the caller. Lives in [`packages/runtime`](../packages/runtime/README.md).

### Credential vault

The port for provider secrets, kept by the instance only. Lives in [`packages/agents`](../packages/agents/README.md); explained in [providers](providers.md).

### Cursor

A position in the journal. A receipt and a query result return the cursor they were written or read at, and a live query follows the journal from it. HTTP encrypts cursors and binds them to the session. A remote query's page cursor is a different thing: the source's opaque token for the next page. Lives in [`packages/runtime`](../packages/runtime/README.md).

### Data provider

One declaration of a kind of record that lives in a system of record and can be searched there live. It becomes two remote queries, `<id>.search` and `<id>.lookup`, so every surface reaches it the same way. Lives in [`packages/contracts`](../packages/contracts/README.md) and [`packages/integration`](../packages/integration/README.md).

### Delivery mode

How a driver action avoids acting twice. `idempotent`: the driver deduplicates by effect ID. `convergent`: the host reads the declared state before and after acting. `once`: the driver answers a lookup, and an unknown outcome holds the effect. A procedure for a workstation application is always convergent. Lives in [`plugins/connector-driver`](../plugins/connector-driver/README.md); explained in [hardware drivers](hardware-drivers.md).

### Delivery outcome

What one delivery attempt returns to the dispatcher. The target accepts or rejects the effect, or acknowledges it and decides later. A transient failure is retried. A stop where the target may have acted throws `DeliveryUncertain` and holds the effect. Lives in [`packages/integration`](../packages/integration/README.md); explained in [systems of record](systems-of-record.md).

### Destination

A network endpoint that a module, host component or child process declares by ID, with its direction, scope, protocol and data classes. The deployment policy binds it to an address, so code never names a customer host. Lives in [`packages/contracts`](../packages/contracts/README.md); explained in [security and compliance](security-and-compliance.md#declarations).

### Deployment policy

The policy one host runs under. It names the hardening floor, the identity floor, destination and folder bindings, process pins and ingress. A site runs under one. A desktop-local host can run under one. That host is not a site. The launcher setting is `--site-policy`. Lives in [`plugins/site`](../plugins/site/README.md); explained in [security and compliance](security-and-compliance.md#deployment-policy).

Do not use: site policy, deployment config, environment file, settings (for the deployment policy).

### Device

A paired phone or tablet, identified as `device:<id>`, or a hardware device a module declares. A page says "paired device" or "hardware device" when the context does not decide. Explained in [mobile](mobile.md) and [hardware drivers](hardware-drivers.md).

### Device link

Pairing a phone or tablet with a hub. An administrator creates a one-use enrollment code on the hub; the device exchanges it for its own bearer credential and presents that on every later request. Lives in [`plugins/device-link`](../plugins/device-link/README.md); the device side is [`plugins/hub-link`](../plugins/hub-link/README.md).

### Dispatcher

The worker that claims queued, retrying and upstream effects, delivers them through the connector outside any transaction, and settles their outcome under the integration principal. Lives in [`packages/integration`](../packages/integration/README.md); explained in [systems of record](systems-of-record.md).

Do not use: outbox worker, relay (for the dispatcher).

### Display metadata

What a capability declares about how it and its records are shown: a label, the resource kind its records name, their key, title field and shown fields. Generic screens, the command palette, MCP tool titles and the generated reference read it. Lives in [`packages/contracts`](../packages/contracts/README.md); explained in the [interaction contract](interaction-contract.md).

### Driver

A supervised child process that controls or reads equipment, speaking JSON-RPC over its standard streams and started through the process port. Lives in [`plugins/connector-driver`](../plugins/connector-driver/README.md); explained in [hardware drivers](hardware-drivers.md).

Do not use: agent (for a driver), daemon.

### Driver contract

The browser-safe description of one driver: its state fields, its actions with delivery mode and hazard class, its events, and what it needs from the deployment. The host checks a running driver against the contract's digest at every handshake. Lives in [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Driver SDK

A library in another language that answers the driver protocol for a driver author: bridge-mode gating, a journal for `once` actions, events, and stubs generated from the driver contract. Each SDK proves itself against the reference contract of `plugins/connector-driver`. Lives in [`sdks/driver-python`](../sdks/driver-python/README.md) and [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md).

### Effect

A durable intent to change another system, committed with the command that causes it and delivered later by the dispatcher. Pages call it an outbox effect on first use. Its phases are queued, claimed, retrying, upstream, held, accepted, rejected and cancelled. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [systems of record](systems-of-record.md).

Do not use: delivery intent, durable intent, message (for an effect), job (for an effect), uncertain (for the held phase).

### Egress guard

The path from server code and declared child processes to the network. It admits a destination only when the deployment policy binds it. The reviewed exemptions are listed in `scripts/boundary-rules.ts`; a paired device has no egress guard. Lives in [`plugins/network`](../plugins/network/README.md).

Do not use: firewall (for the guard), proxy (alone), network policy.

### Embedded mode

Running the instance inside the calling process: a CLI call or an MCP bridge with `--embedded`, or a phone that opens its own workspace. Embedded calls open a local workspace only. The opposite of attached mode.

Do not use: in-process mode, standalone mode, local mode.

### Example

An application under `examples/` that demonstrates a pattern and serves as a test fixture. Listed in [getting started](getting-started.md).

Do not use: demo app, reference app.

### Exchange folder

A directory the application exchanges files through with another system, declared by ID with its access and data classes. Only the deployment policy knows its path. Lives in [`packages/contracts`](../packages/contracts/README.md); explained in [security and compliance](security-and-compliance.md#declarations).

### Execution context

Who is calling, in which workspace, under which grant, through which channel, and with which cancellation. The host supplies it; input cannot set or widen it. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: request context, auth context, session (for the execution context).

### Execution host

Runs the tools an agent uses in Linux bubblewrap sandboxes. Each sandbox holds one token bound to its run and its grant, which the plugin issues and revokes. On other platforms a sandbox reports itself unavailable. Lives in [`plugins/execution-host`](../plugins/execution-host/README.md).

Do not use: sandbox (alone, for the execution host), jail, container (for the execution host).

### Extractor

Turns one frame, such as a screen capture or a driver's state read, into readings with a confidence and a provenance. It omits a field it cannot read instead of failing. Lives in [`packages/observation`](../packages/observation/README.md); [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) fixes it to screen captures.

### Feature

A reusable domain part an application mounts once, such as approval requests: modules whose operations start with the feature's ID, a state slice under that ID, handlers and a policy. The application supplies an access view and hooks when it mounts it. Declared with `defineFeatureManifest` and `defineFeature`; explained in [architecture](architecture.md#features-and-host-plugins). A harness's `features` flags are unrelated.

Do not use: component (for a feature), extension, mixin.

### Feed

The inbound side of a target: the item schema, the most items one batch may carry, and the records a batch changes. Inbound sync applies feed batches. Lives in [`packages/contracts`](../packages/contracts/README.md).

### Fencing token

A number that grows with each new holder of a worker claim or a workspace lease. A write that carries an older token fails, so a stalled holder cannot overwrite the one that took over. Lives in [`packages/runtime`](../packages/runtime/README.md) and [`packages/adapters`](../packages/adapters/README.md).

### Fleet

An application that sites report to: enrollment, health, signed releases, forwarded audit events and relayed remote access. The fleet agent is the site-side plugin. Lives in [`examples/fleet`](../examples/fleet/README.md) and [`plugins/fleet-agent`](../plugins/fleet-agent/README.md); explained in [hosting](hosting.md#fleet).

Do not use: control plane, management server, central server.

### Framework

The domain-neutral packages under `packages/`. The framework names no domain and imports no plugin or example.

Do not use: core (for the framework), platform (for the framework), library (alone).

### Framework release

The framework, workstation and plugin packages published together at one version. `bun run check:manifests` refuses packages at different versions, and `bun run check:framework` reports an application that installed more than one. Lives in `scripts/release.ts`; explained in [development and testing](development-and-testing.md).

### Gated actuator

A connector that acts on a screen or on equipment only after a deterministic gate: the bridge mode, the seat or local control, and a readback that confirms the result. A model may resolve a target or suggest a step; it never acts itself. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) and [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Generator

A pure transformation from the catalog to a reference document. The outputs are the catalog contract, OpenAPI, the capability, workflow and agent references, the application skill, and the security manifest with its data flows. MCP tools, the HTTP API and schemas are generated when served. `bun run generate` writes the rest to `dist/reference/`, and nothing generated is committed. Lives in `scripts/reference-artifacts.ts`.

### Golden check

Replays labeled frames through a station profile and its extractors and reports per-field accuracy and confidence. It is run before a profile or model change is used, and a confident wrong reading must stay at zero. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md).

### Grant

The permission a caller acts under: the capabilities, resources and expiry it may use, bound to a principal and a workspace. A delegated grant narrows an issuer's own access for an agent run, a trigger or another process. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [authorization](authorization.md).

Do not use: delegation grant, token (for a grant), permission set, scope (alone, for a grant).

### Grant file

A JSON file an orchestrator writes for a process it starts: the principal, the capabilities and optionally the resources, expiry and workspace. An embedded CLI or MCP process acts under it, and tool arguments cannot widen it. Lives in [`packages/adapters`](../packages/adapters/README.md); explained in [systems of record](systems-of-record.md).

### Handler

The server function that implements one capability. It receives the execution context and injected services, never a transport request, and makes no network or model call. Lives in the application definition.

Do not use: resolver, service method.

### Hardening profile

The floor a deployment policy sets for identity, delegated grants, audit and egress: `desktop-local`, `site-hub`, `sandbox` or `zero-trust`. Explained in [security and compliance](security-and-compliance.md#deployment-policy).

Do not use: profile (alone, for a hardening profile), security level, mode (for a hardening profile).

### Harness

The adapter that runs one model turn for an agent run and returns its tool calls and output. Codex, Claude, the AI SDK, a local model and a deterministic fixture are harnesses. Lives in [`packages/agents`](../packages/agents/README.md); explained in [agents](agents.md).

Do not use: LLM harness, agent runtime, model adapter.

### Hazard class

What a declared action can do to people or equipment. `none` runs in assist mode, `low` needs actuate mode, and `operator-present` needs actuate mode and a confirmation at the workstation in the effect payload. Procedures for a workstation application and driver actions use the same classes. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) and [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Host

The process that opens an instance for one application on a host platform and serves it: the Bun host behind the desktop and browser, or the mobile host. Lives in [`packages/host`](../packages/host/README.md) and [`packages/mobile`](../packages/mobile/README.md).

Do not use: service (for the host), server (alone, for the host), daemon.

### Host component

A part of the host, such as the audit forwarder or a screen bridge, that declares its own requirements with `defineHostComponent`. Lives in [`packages/contracts`](../packages/contracts/README.md).

### Host platform

What the composition needs from the machine: workspace ownership, storage, a blob store, an optional secret store and the host's own components. It also states what it can offer: raw sockets, child processes, ingress and folders. The Bun platform, the hosted platform and the mobile platform are host platforms. Lives in [`packages/kernel`](../packages/kernel/README.md).

Do not use: platform (alone, for a host platform), runtime environment, OS (for a host platform).

### Host plugin

A cross-cutting part an application composes: a feature with ports, settings and lifecycle hooks, and the same three entrypoints as an application. Lives in `plugins/`; explained in [architecture](architecture.md#host-plugins). "Plugin" alone means a host plugin after first use.

Do not use: framework plugin, add-on.

### Hosted instance

The Bun host on the hosted platform: the workspace in a shared Postgres database, ownership as a workspace lease, and TLS ingress with workforce sign-in from the deployment policy. Explained in [hosting](hosting.md#hosted-instance).

Do not use: cloud mode, multi-tenant host, server deployment.

### Hub

The instance that phones and tablets pair with and deliver to, usually the site's host under the `site-hub` hardening profile. Explained in [mobile](mobile.md).

Do not use: server (for the hub), base station, gateway (for the hub).

### Idempotency key

The caller-chosen key that makes a repeated command return its first receipt instead of running again. A reused key with different input conflicts. Explained in [interaction contract](interaction-contract.md).

Do not use: request ID (for the key), dedupe key.

### Inbound sync

Importing a system of record's changes as ordinary commands. Each feed batch is bound to a watermark range, so two pullers cannot apply the same batch. Lives in [`packages/integration`](../packages/integration/README.md).

Do not use: import job, pull sync, replication (for inbound sync), mirror (as a noun, for inbound sync).

### Input source

Device input, such as a scan, normalized into events and routed to a capability without a model turn. Lives in [`packages/devices`](../packages/devices/README.md); explained in [point-of-work input](point-of-work-input.md).

### Instance

One application opened on one workspace: its plugins and ports, storage, the runtime and the integrations. While it is open it is the only writer of that workspace and executes the workspace's commands and queries. A host opens an instance; an embedded CLI or MCP process opens its own. Each opening gets a new instance ID, which audit records and the workspace lease name. Lives in [`packages/kernel`](../packages/kernel/README.md) and [`packages/runtime`](../packages/runtime/README.md).

Do not use: authority, application runtime, server (for the instance).

### Integration principal

The narrow principal the dispatcher and inbound sync run as. It can settle, sync and read status, and nothing else.

Do not use: system principal, bot user.

### Journal

The ordered record of committed changes that live queries follow. Each entry names the changed resource and the revision. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [state and reactivity](state-and-reactivity.md).

Do not use: event stream (for the journal), changelog, event log (for the journal).

### Launch exchange

How a browser gets its session. The host issues a one-use launch key that expires after 60 seconds, and the web frame exchanges it for the session cookie. Lives in [`packages/adapters`](../packages/adapters/README.md) and [`packages/frame`](../packages/frame/README.md).

### Live query

A query a screen keeps current by following the journal. It refetches when a declared dependency changes, ignores stale responses and reconnects from its cursor. Lives in [`packages/client`](../packages/client/README.md) and [`packages/react`](../packages/react/README.md).

Do not use: subscription (for a live query), live view, reactive query, real-time query.

### Manifest

The browser-safe entrypoint of an application or host plugin: its ID, title, modules and host components. An application manifest also lists its composed plugins and the platforms it is delivered to. The web build and the generators import it without loading handlers or provider code. Lives in [`packages/kernel`](../packages/kernel/README.md).

Do not use: client manifest.

### Membership

The roles people hold in a container, kept by the framework and changed with the membership command. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: ACL, role assignment.

### Model entry

A model the model server may serve, named by an ID and the digest of its base weights. A fine-tune adds its adapter's digest and the digest of the dataset it was trained on. Declared in [`packages/agents`](../packages/agents/README.md); measured and served by [`plugins/model-server`](../plugins/model-server/README.md).

Do not use: model config, checkpoint (for a model entry), model registration.

### Module

The browser-safe unit a domain contributes to the catalog: capabilities, requirement declarations, OS declarations, workflows and agent definitions, declared with `defineModule`. Its handlers, state slice and policy are server code supplied with the application definition or the host plugin. Lives in [`packages/contracts`](../packages/contracts/README.md).

Do not use: capability module, domain module, bounded context, package (for a module).

### Nested invocation

A command or query that a handler runs with `ctx.invoke` or `ctx.query` inside its own command's transaction, under the same context. The capability lists the operations it may call in `invokes`. Each call is authorized on its own, with `via` naming the enclosing operations, and a refusal rolls back the whole command. Calls go at most 4 levels deep and 64 per command. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [capability authoring](capability-authoring.md#nested-calls).

Do not use: sub-command (for a nested invocation).

### Observation

A reading from a source that cannot be queried, such as a broker topic, a controller tag or the screen of a workstation application, submitted through an ingest command. Lives in [`packages/observation`](../packages/observation/README.md).

Do not use: reading (alone), signal (alone), sample (alone).

### Operator

A person who works at a workstation or a point of work, usually under an `operator` role the application declares. A person who installs and runs a site is a site operator.

### OS action

A declared request to the operating system to open a URL, reveal or open a file, share, notify or send an Android intent, with the data classes it carries. Lives in [`packages/shell`](../packages/shell/README.md); explained in [desktop](desktop.md).

### OS handler

A declared registration with the operating system, such as a link path, file type, share target, Android intent, shortcut or notification reply, and the capability its requests go to. Lives in [`packages/shell`](../packages/shell/README.md).

Do not use: deep link handler (for the primitive), protocol handler (alone), intent filter (alone).

### Outbox

The part of the workspace that holds effects until the dispatcher delivers them. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: queue (for the outbox), message queue, job queue.

### Owner

The local owner is the principal `owner`. Where the identity policy admits it, the host issues it a session and a connection file, and an embedded call without a grant file acts as it. An application may also declare an `owner` role in a container. Lives in [`packages/kernel`](../packages/kernel/README.md).

### Peer

Another agent-native application enrolled with this one through the peer link. It calls the peer surface as its service principal, `peer:<id>`, or on behalf of a person through a subject assertion. Lives in [`plugins/peer-link`](../plugins/peer-link/README.md).

Do not use: partner, remote application, federation (for a peer).

### Peer link

Enrollment of, and calls between, two agent-native applications. An administrator of the called application creates a one-use enrollment code. The calling application exchanges it for a bearer credential and registers an Ed25519 public key. Lives in [`plugins/peer-link`](../plugins/peer-link/README.md); explained in [systems of record](systems-of-record.md#peer-applications).

Do not use: device link (for a peer link; a device link pairs a phone with a hub).

### Peer surface

The commands and queries an application lets a peer call: those its service principal may call, and those a peer may call on behalf of a mapped person. Declared with `definePeerSurface` in [`packages/contracts`](../packages/contracts/README.md). A peer surface is not a [surface](#surface).

### Peer target

A target that is another agent-native application, declared with `definePeerTarget` from the peer surface that application publishes. It adds a network destination, effect requests parsed by the peer commands' input schemas, and a feed from a service query of the surface. Declared in [`packages/contracts`](../packages/contracts/README.md); connected with `connectPeerTarget` from [`packages/integration`](../packages/integration/README.md).

### Perception source

An extractor for screen captures in `workstations/screen-bridge/src/perception`: the accessibility tree, a perception worker process speaking JSON lines, or a vision model behind an OpenAI-compatible endpoint. A vision endpoint must be loopback or explicitly allowlisted. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md); explained in [operator workstations](operator-workstations.md).

### Person

A human caller: an operator, inspector, supervisor, auditor or owner at a screen or a workstation. Used when the page contrasts people with agents, scripts and devices.

Do not use: user (except "OS user"), end user, human operator (when "operator" is a role).

### Plugin service

The object a host plugin exposes to later plugins and to handlers as `services[<plugin id>]`, such as the audit plugin's log directory and forwarder statistics. It is trusted code like the plugin. Lives in [`packages/kernel`](../packages/kernel/README.md).

### Point of work

The place where an operator, a device or station software produces the input an application captures: a station PC, a site server or a phone next to the equipment.

Do not use: edge (for the point of work), shop floor (as a term).

### Policy

The port that decides operation, object, row and field access for a principal, built with `definePolicy` or the CASL adapter. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [authorization](authorization.md).

Do not use: permissions (for the policy), authorization layer, RBAC.

### Policy lane

A policy rule that recognizes one integration principal and lists the only capabilities it may call. A target's lane covers its settle and sync commands. Lives in [`packages/runtime`](../packages/runtime/README.md) and [`packages/integration`](../packages/integration/README.md).

### Principal

The identity a caller acts as: a person, a device, the integration principal or an agent run's issuer. The host derives it from the session; input cannot choose it. Explained in [authorization](authorization.md).

Do not use: identity (for the principal), account (for the principal), user ID.

### Procedure

A declared sequence of screen steps in a station profile, run for one effect type. It carries preconditions, a hazard class, a readback that proves it took effect, and whether it may run again after an interruption. The screen bridge runs nothing else. A driver's counterpart is an action in its driver contract. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md).

### Process port

The host port that starts declared child processes from the deployment policy's bindings. Its default refuses. Lives in [`plugins/process`](../plugins/process/README.md).

### Query

An authorized read of one snapshot that changes nothing and returns a cursor the caller can follow. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: read operation, getter.

### Receipt

The stored result of a command under its idempotency key: the outcome, the changed resources and any continuation. A replay returns the receipt. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: result record, response cache, ack (for a receipt).

### Reconciliation

The tracked state and procedure for effects whose outcome no one can establish automatically. A person settles or releases a held effect through the framework's reconciliation commands. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [systems of record](systems-of-record.md).

Do not use: manual resolution, exception handling (for reconciliation).

### Release

Always qualified. Releasing a held effect returns it to queued for another delivery. A framework release and a site bundle installed as a site release have entries of their own. Releasing workspace ownership ends an instance's hold on its workspace.

### Remote query

A query that reads another system when the caller runs the query, and stores nothing. The query acts with the caller's credential, or with a service credential where the query declares that fallback. Lives in [`packages/runtime`](../packages/runtime/README.md); explained in [systems of record](systems-of-record.md).

Do not use: live search (for the primitive), passthrough query, proxy query, federated query.

### Requirement declaration

What a module, host component or plugin needs outside the process, as data: destinations, exchange folders, devices and child processes. The deployment policy binds them. Explained in [security and compliance](security-and-compliance.md#declarations).

Do not use: dependency declaration, capability requirement, permission request.

### Revision

The per-resource counter a command bumps. `expectedRevisions` makes a stale write conflict. Explained in [interaction contract](interaction-contract.md).

Do not use: version (for a revision), etag.

### Sample

A small application under `samples/` that shows one concept. `samples/lab-requests` is the base, and every other sample composes it unchanged and adds one concern. Listed in [samples](samples.md).

Do not use: demo (for a sample).

### Scaffold

The tool that exports the framework, the starter and content as a standalone application, or generates a new application and its parts. Lives in [`packages/scaffold`](../packages/scaffold/README.md).

Do not use: generator (for the scaffold), boilerplate, CLI (for the scaffold).

### Scanner profile

Schema-validated data describing how one scanner at one workstation reaches the application and how its output is normalized. Its transport is a keyboard wedge, a serial port, HID POS, a camera, a host plugin or an Android intent. Lives in [`packages/devices`](../packages/devices/README.md); explained in [point-of-work input](point-of-work-input.md).

### Screen

One routed part of an application's UI, declared in its `screens` entrypoint and bound to capabilities through the typed client. The display of a workstation application is its screen. Explained in [architecture](architecture.md#application-entrypoints).

Do not use: view (for a screen), page (for a screen), frontend (for the screens), route (for a screen), station screen, bridged screen.

### Screen bridge

The connector that reads a workstation application through its screen and drives declared procedures on it. It is not the workstation. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md); explained in [operator workstations](operator-workstations.md).

Do not use: station (for the screen bridge), computer use (for the screen bridge).

### Seat

The working position at a workstation and who holds it. The screen bridge reads the holder, `operator`, `agent` or `idle`, before every action and does not act while the operator holds it. For workstation sign-in, a seat is a principal listed as one, whose session may sign operators in. Explained in [operator workstations](operator-workstations.md).

### Session

What a host issues to an authenticated caller; the execution context is derived from it. It is a browser cookie after the launch exchange, the bearer token of a connection file, or a paired device's credential. It is also a workforce sign-in cookie or a workstation sign-in. Lives in [`packages/adapters`](../packages/adapters/README.md).

Do not use: login (for a session), token (alone, for a session), connection (for a session).

### Settlement

Recording a system of record's outcome for one effect, accepted or rejected, through the target's settle command. The dispatcher settles under the integration principal with its fencing token. A person settles a held effect through reconciliation. Lives in [`packages/integration`](../packages/integration/README.md); explained in [systems of record](systems-of-record.md).

### Shell port

The host port that receives OS requests under declared OS handlers and performs declared OS actions. Without a plugin that provides it, every call fails with `UNAVAILABLE`; `plugins/os` provides it. Lives in [`packages/kernel`](../packages/kernel/README.md).

### Site

A plant, office or customer location where a host runs under one deployment policy. A desktop-local host is not a site.

Do not use: location (for a site), deployment (for a site), customer (for a site).

### Site bundle

One signed, versioned directory per application and platform, checked before a site installs it. It holds the payload, a manifest with every file's digest and the declared requirements, and an Ed25519 signature. `site install` verifies it and places it as a release, and a failed step leaves the previous release current. Lives in [`packages/bundle`](../packages/bundle/README.md) and [`plugins/site`](../plugins/site/README.md).

### Snapshot

One consistent read of a workspace at a journal cursor. A query reads one snapshot.

Do not use: state dump, checkpoint (for a snapshot), copy (for a snapshot).

### Standing grant

A person's recorded, expiring permission for a trigger to act as that principal. Lives in [`plugins/automation`](../plugins/automation/README.md).

Do not use: persistent grant, saved permission, long-lived grant.

### Starter

The thin application host a team forks or generates and then owns: `apps/service`, `apps/web`, `apps/desktop` and `apps/mobile`. It hosts the one application named in `app.config.json`.

Do not use: template app, boilerplate, shell (for the starter).

### State migration

Numbered versions of an application's and each plugin's state, with the steps between them, stamped per workspace. Storage runs the steps on every load until a commit persists the result. The `migrate` command migrates a checked copy of the database before it replaces the live one. Lives in [`packages/kernel`](../packages/kernel/README.md) and [`packages/host`](../packages/host/README.md).

Do not use: schema migration, upgrade script, data migration.

### Station profile

Versioned data describing one kind of workstation application: how to recognize its screens and where each field is shown and read. It also marks the forbidden regions and declares the procedures the screen bridge may run. Lives in [`workstations/screen-bridge`](../workstations/screen-bridge/README.md); explained in [operator workstations](operator-workstations.md).

Do not use: profile (alone, for a station profile).

### Storage

The port for the instance's transactional state. The memory adapter is in `packages/runtime`. The SQLite and Postgres adapters store one row per record and write only what a commit changed. The mobile host uses the snapshot adapter, which stores each workspace as one JSON document. Lives in [`packages/runtime`](../packages/runtime/README.md) and [`packages/adapters`](../packages/adapters/README.md).

Do not use: database (for the port), persistence layer, store (alone).

### Subject assertion

The signed `Agent-Native-Subject` header with which a peer names the person a request is made for. The key the peer enrolled signs the audience, the subject, the request line, the body digest and a lifetime of at most 120 seconds. The called application accepts each assertion once. Lives in [`plugins/peer-link`](../plugins/peer-link/README.md).

### Subject mapping

The called application's table from a peer's subject IDs to its own principals. A call on behalf of an unmapped subject is refused, and no subject maps to a `peer:` or `device:` principal or a reserved principal. Managed with `peer.subject.map` in [`plugins/peer-link`](../plugins/peer-link/README.md).

### Surface

One way callers reach the catalog: the screens, HTTP, MCP, the CLI or the typed client. A surface adapter maps one surface onto the instance's command and query entry points. Lives in [`packages/adapters`](../packages/adapters/README.md). A [peer surface](#peer-surface) is unrelated.

Do not use: transport (for a surface), channel (for a surface), interface (for a surface), API (alone).

### System of record

Another system that owns records the application reads or changes, and that decides what it accepts. It cannot join the application's transaction, so the application reaches it through a target. Explained in [systems of record](systems-of-record.md).

Do not use: SoR, external system, upstream system, backend system, legacy system, remote system (for a system of record; "remote system of record" is fine).

### Target

The declaration of one system of record with `defineTarget`: its settle, sync and status commands and queries, the integration principal's capabilities and its policy lane. A target's connector delivers its effects. The manifest's `targets` field is unrelated; it lists delivery platforms. Declared in [`packages/contracts`](../packages/contracts/README.md); its handlers and policy lane live in [`packages/integration`](../packages/integration/README.md).

Do not use: destination (for a target; a destination is a network binding), integration (for a target), endpoint (for a target).

### Task package

The name [primitives](primitives.md) uses for a site bundle together with its install: a signed, versioned package with declared requirements, staged activation and rollback. Pages say site bundle.

### Telemetry

OpenTelemetry metrics and traces of commands, outbox delivery and backlog, and runs, derived from the audit log and the outbox. The metrics and traces are exported through the egress guard without record contents. A driver's `telemetry` event is different: it enters as an observation. Lives in [`plugins/telemetry`](../plugins/telemetry/README.md).

### Tortoise

The name of the project: the framework, workstation packages, host plugins, starter, examples, samples and driver SDKs in this repository. Package names keep the `@agent-native/` scope. Explained in the [README](../README.md#name).

Do not use: agent-native desktop starter (for the project).

### Trigger

Work that starts on a committed change or a schedule instead of a person's prompt. A trigger submits commands under a standing grant like any caller. Lives in [`plugins/automation`](../plugins/automation/README.md).

Do not use: hook (for a trigger), cron job, automation (alone, for a trigger).

### UI binding

The screen control a capability declares it is reached from, or the stated reason it has none. Building the catalog fails for a capability with neither. An application's UI-binding test fails when no screen references a capability that claims a binding. Lives in [`packages/contracts`](../packages/contracts/README.md) and [`packages/testing`](../packages/testing/README.md).

### UI intent

A request from an agent run to the screen it started from: open a resource, select one, or ask for a review. It is checked under the run's grant, expires, and changes no records. Lives in [`packages/contracts`](../packages/contracts/README.md) and [`packages/adapters`](../packages/adapters/README.md); explained in the [interaction contract](interaction-contract.md#ui-intents).

### UI registry

Reusable screen parts published as shadcn registries over stock shadcn primitives, which an application copies with `shadcn add` and then owns. The `agent-native` registry ships in [`packages/frame`](../packages/frame/README.md); the `operator` registry ships in [`packages/operator-ui`](../packages/operator-ui/README.md).

### UI session context

The selection and observed revisions a screen shares with an agent run, checked against authorized queries and frozen when the run captures it. A run started from it can send [UI intents](#ui-intent) back to the screen. Lives in [`packages/adapters`](../packages/adapters/README.md); explained in [authorization](authorization.md).

### Watermark

The target's opaque position after the last applied feed batch, stored in the application's state. A sync batch whose start is not the stored watermark conflicts. Lives in [`packages/integration`](../packages/integration/README.md).

### Web frame

The domain-neutral browser shell around one application's screens: session, routing, palette, run panel and accounts. The native frame is its React Native counterpart. Lives in [`packages/frame`](../packages/frame/README.md) and [`packages/frame-native`](../packages/frame-native/README.md).

Do not use: shell (for the web frame), layout (for the web frame), app shell, chrome.

### Worker claim

The dispatcher's hold on one effect: a worker name, an expiry and a fencing token. A claim whose expiry passed reads as the phase before it, and another worker may take the effect over. Lives in [`packages/runtime`](../packages/runtime/README.md).

Do not use: lock (for a claim), lease (alone, for a claim), reservation.

### Workflow

A sequence of capabilities a module declares for agents: prose `text` with the operations it names, and, when declared with `defineWorkflow`, steps that run a command or wait on a query, with their bindings, retries, timeouts and compensations. The catalog checks a declared workflow against the operations it names. Lives in [`packages/contracts`](../packages/contracts/README.md).

Do not use: process (for a workflow; the process port starts child processes), saga, pipeline.

### Workflow instance

One run of a declared workflow, started with `workflow.start` and advanced one step per command by the workflows plugin's runner, as its starter under a grant narrowed to the workflow's operations. It ends succeeded, compensated, failed or cancelled, or stalls for a person. Lives in [`plugins/workflows`](../plugins/workflows/README.md).

Do not use: workflow run, job (for an instance).

### Workforce sign-in

People signing in to a serving host through the site's identity provider under `identity: external`. Lives in [`plugins/site`](../plugins/site/README.md).

Do not use: SSO (alone), enterprise login, OIDC login (for the primitive).

### Working set

The copies of system-of-record records that an application keeps for its tasks, such as inspection lots or MES orders. Inbound sync keeps them current, and the system of record stays authoritative for them. Lives in each application's state.

Do not use: cache (for the working set), mirror.

### Workstation

The edge workplace where operators sign in at a seat. A workstation application already running there is read and driven through the screen bridge. The packages live under `workstations/`, between the framework and the host plugins. Explained in [operator workstations](operator-workstations.md).

Do not use: station (for a workstation).

### Workstation application

Software already running at a workstation that has no API and must stay unmodified. A vendor HMI, test-bench software and an MES client are workstation applications. The screen bridge reads and drives its screen. Explained in [operator workstations](operator-workstations.md).

Do not use: station software, bridged program, application (alone, for a workstation application), HMI (for a workstation application; an HMI is one kind).

### Workstation sign-in

An operator signing in at a workstation by badge and PIN, for a short-lived session issued to that operator. Only a seat's own session may sign people in, and signing in does not move a seat an agent holds. Lives in [`workstations/sign-in`](../workstations/sign-in/README.md).

### Workspace

The data one instance owns: state, revisions, receipts, journal, outbox, blobs and plugin slices, at one path or in one database. One instance holds it at a time, through an OS lock or a workspace lease. A package of this repository is a framework package, a workstation package, a plugin, an app, an example or an SDK, not a workspace.

Do not use: database (for a workspace), tenant, project (for a workspace), data directory (for the concept).

### Workspace lease

One instance's hold on a hosted workspace, kept in the shared database with a fencing token that every commit checks. Another instance can take the workspace over once the lease expires. Lives in [`packages/adapters`](../packages/adapters/README.md); explained in [hosting](hosting.md).

Do not use: lock (for a lease), ownership record, heartbeat (for the lease).

## References

- [Point-of-work input](point-of-work-input.md)
- [Overview](overview.md)
