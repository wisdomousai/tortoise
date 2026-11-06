# Concept reference

This reference defines framework terms and identifies the code that implements them. Terms are ordered alphabetically. Implementation status describes the available code; dated execution evidence and known gaps belong in [Implementation status](implementation-status.md).

A term marked `partial` has an incomplete implementation or a documented platform limit. `Proposed` identifies planned code. An unmarked entry defines terminology without assigning an implementation status.

## Terms

### Action checks

The checks a connector passes before it acts on a screen or on equipment. A model may suggest an action. Deterministic code checks, executes and verifies it.

implemented · [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) [`packages/integration`](../packages/integration/README.md) [`plugins/connector-driver`](../plugins/connector-driver/README.md)

### Adapter

An implementation of a framework port, such as the SQLite storage adapter or the CASL authorization adapter. See [`packages/adapters`](../packages/adapters/README.md).

### Agent definition

A named agent in the catalog: instructions, capabilities, commands it requests approval for, resource types, model requirement, output mode and budgets.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md) [`packages/agents`](../packages/agents/README.md) [`packages/adapters`](../packages/adapters/README.md)

### Agent run

An agent acting as one more caller on the catalog, under a grant narrowed from its issuer's. A run keeps what the person asked and their answers; the runs of one conversation share its ID, and the frame's assistant panel shows them.

implemented · [`packages/agents`](../packages/agents/README.md) [`packages/host`](../packages/host/README.md) [`packages/frame`](../packages/frame/README.md)

### Agent scenario

A test of an agent definition on a task and fixture state. The test judges the run by the commands it committed and the approval requests it submitted, not by its text.

implemented · [`packages/testing`](../packages/testing/README.md)

### Application

One unit of content that a host runs: its manifest, its application definition and its screens.

implemented · [`packages/kernel`](../packages/kernel/README.md) [`packages/host`](../packages/host/README.md) [`packages/frame`](../packages/frame/README.md)

### Application definition

The server entrypoint of an application, declared with `defineApplication` from [`packages/kernel`](../packages/kernel/README.md).

### Approval dataset

The approval requests people approved, rejected or let expire, exported as training data with redaction and a digest.

implemented · [`packages/runtime`](../packages/runtime/README.md)

### Approval request

A command that one caller, usually an agent run, asks a person to approve before it runs. The approved command runs under the approver's own grants and policy. The `approval` feature keeps approval requests.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/operator-ui`](../packages/operator-ui/README.md)

### Assignee

Who takes an assignment: a person, an agent definition, a paired device, a peer or an assignment target. See [`packages/assignments`](../packages/assignments/README.md).

### Assignment

Work handed to a person, an agent, a paired device, a peer application or a target, with instructions. The assignee sends back structured reports. A person accepts or discards each one. The `assignment` feature keeps assignments and reports.

implemented · [`packages/assignments`](../packages/assignments/README.md) [`packages/frame`](../packages/frame/README.md)

### Assignment kind

The declaration of one kind of assignment: the scope a planner fills in, the instructions, one report's body and subject, the reviewer's accept input, and the assignee types that may take it.

### Assignment report

One result an assignee sends back on an assignment, under an ID the reporter chose. See [`packages/assignments`](../packages/assignments/README.md).

### Attached mode

Running a CLI, MCP bridge, desktop window or phone against an instance that another process owns, through a session that instance issued. See [architecture](architecture.md#instances-and-hosts).

### Audit log

The configured record of runtime operations and host activity. The audit plugin supplies durable hash-chained storage; the kernel default has no persistent audit log. See [Security and compliance](security-and-compliance.md#audit-log).

implemented · [`plugins/audit`](../plugins/audit/README.md)

### Behavioral scenario

A named test of business behavior that runs unchanged through the direct, HTTP, CLI and MCP drivers. The results must agree.

implemented · [`packages/testing`](../packages/testing/README.md)

### Best-before date

The last day a build is within its [shelf life](#shelf-life): the build date plus the shelf life, in UTC. See [`packages/kernel`](../packages/kernel/README.md), [application lifecycle](hosting.md#shelf-life-and-best-before-date).

### Blob

Content-addressed bytes, such as a photo or a document, that a command references from a resource. See [`packages/runtime`](../packages/runtime/README.md).

### Blob store

Content-addressed bytes, such as photos and documents, that commands reference from resources. An upload stays attachable by its uploader for the grace period, across a restart. A hosted instance keeps blobs in Postgres. No retention setting or thumbnails yet.

partial · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md) [`packages/adapters`](../packages/adapters/README.md) [`packages/client`](../packages/client/README.md) [`packages/kernel`](../packages/kernel/README.md)

### Bridge mode

How far a screen bridge or a driver bridge may act. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Bundle

A signed, versioned directory per application and platform, with declared requirements and staged activation. A failed install step leaves the previous release current.

partial · [`packages/bundle`](../packages/bundle/README.md) [`scripts/bundle.ts`](../scripts/bundle.ts) [`plugins/deployment/src/install`](../plugins/deployment/src/install)

### Caller

The source of an operation request. Its trusted principal and grant are supplied by the host in the execution context.

### Capability

An operation declared in the catalog as a command or query.

implemented · [`packages/contracts`](../packages/contracts/README.md)

### Capability binding

A UI control bound to a capability through the typed client.

implemented · [`packages/react`](../packages/react/README.md)

### Catalog

The composed, validated description of everything the application can do.

implemented · [`packages/contracts`](../packages/contracts/README.md)

### Channel

One way callers reach the catalog: the screens, HTTP, MCP, the CLI or the typed client. The host records the channel of each request in the execution context and in audit records: `direct`, `http`, `mcp`, `cli`, `embedded`, `integration`, `harness`, `host` or `shell`.

### Channel adapter

The adapter that maps one channel onto the instance's raw command and query entry points.

implemented · [`packages/adapters`](../packages/adapters/README.md)

### Collection

A typed set of records that a module keeps in its state slice. The framework generates its reads and its create, update, move and retire commands. A tree collection also gets a tree read.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md)

### Command

An operation executed in a workspace transaction under the caller's authorization.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/contracts`](../packages/contracts/README.md)

### Command result

The stored result of a command under its idempotency key: the outcome, the changed resources and any continuation.

### Compensation

The command a declared workflow step names to undo it. See [`plugins/workflows`](../plugins/workflows/README.md).

### Compliance bundle

What an auditor checks. The generator derives it from the catalog and the deployment policy; the compliance monitor re-checks it while the application runs.

implemented · [`plugins/compliance`](../plugins/compliance/README.md) [`packages/host`](../packages/host/README.md)

### Composition

The portable layer that composes an application and its plugins, resolves the host ports and opens one instance. See [`packages/kernel`](../packages/kernel/README.md).

### Connection file

A private JSON file with a loopback endpoint and a bearer token, which the host writes as `.connection.json` in the workspace directory. See [`packages/adapters`](../packages/adapters/README.md), [`packages/host`](../packages/host/README.md).

### Connector

The implementation of a target's port, `SystemOfRecordPort`. It delivers effects to one system of record and looks up their outcome.

implemented · [`packages/integration`](../packages/integration/README.md) [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) [`packages/testing`](../packages/testing/README.md) [`plugins/connector-driver`](../plugins/connector-driver/README.md) [`plugins/connector-files`](../plugins/connector-files/README.md) [`plugins/connector-http`](../plugins/connector-http/README.md) [`plugins/notifications`](../plugins/notifications/README.md)

### Container

The application-defined scope to which a membership assigns roles. See [Authorization](authorization.md).

### Continuation

A command a handler asks for with `continueWith`, run after the handler's frame as a [nested call](#nested-call) in the same transaction under the same context. See [`packages/runtime`](../packages/runtime/README.md).

### Control

Who controls a workstation application's screen: `operator`, `agent` for the screen bridge, or `idle`. The bridge control reports it as `controlledBy`. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [operator workstations](operator-workstations.md#control).

### Credential vault

The port for provider secrets.

implemented · [`packages/agents`](../packages/agents/README.md)

### Cursor

A position in the journal. See [`packages/runtime`](../packages/runtime/README.md).

### Data provider

One declaration of what callers can search a system of record for. It becomes ordinary catalog entries for every channel.

partial · [`packages/contracts`](../packages/contracts/README.md) [`packages/integration`](../packages/integration/README.md)

### Decommissioning

Removal of an application and its installation data after required delivery and retention work. The local purge command checks unresolved outbox effects; preserving other local records requires an explicit backup. See [Deployment and operation](hosting.md#decommissioning-procedure).

### Delivery mode

How a driver action avoids acting twice. See [`plugins/connector-driver`](../plugins/connector-driver/README.md), [hardware drivers](hardware-drivers.md).

### Delivery outcome

What one delivery attempt returns to the dispatcher. See [`packages/integration`](../packages/integration/README.md), [systems of record](systems-of-record.md).

### Deployment policy

Deployment data that binds declared destinations to addresses and exchange folders to directories, and sets a hardening floor.

implemented · [`plugins/deployment`](../plugins/deployment/README.md)

### Destination

A network endpoint that a module, host component or child process declares by ID, with its direction, scope, protocol and data classes. See [`packages/contracts`](../packages/contracts/README.md), [security and compliance](security-and-compliance.md#declarations).

### Device

A paired phone or tablet, identified as `device:<id>`, or a hardware device a module declares. See [mobile](mobile.md), [hardware drivers](hardware-drivers.md).

### Device configuration

The `device` feature: per-workstation device configuration, the scanner profiles and scan routes, as ordinary commands and queries. The mounting application authorizes them through a station relation.

implemented · [`packages/devices`](../packages/devices/README.md)

### Device link

Pairing a phone or tablet with a hub, and the credential the device presents afterwards.

partial · [`plugins/device-link`](../plugins/device-link/README.md) [`plugins/hub-link`](../plugins/hub-link/README.md)

### Dispatcher

The worker that delivers pending effects and completes them under the narrow integration principal.

implemented · [`packages/integration`](../packages/integration/README.md)

### Display metadata

How screens show a capability and its records: label, resource kind, key, title field and fields, each field with a label and a kind (date, date-time, status with tones, reference, file). A CSV export of a list takes its columns from the fields.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/adapters`](../packages/adapters/README.md)

### Driver

A supervised child process that controls or reads equipment, speaking JSON-RPC over its standard streams, which the process port starts. See [`plugins/connector-driver`](../plugins/connector-driver/README.md), [hardware drivers](hardware-drivers.md).

### Driver contract

A driver's state fields, its actions with delivery mode and risk level, and its events, as data. The contract has a digest that the driver must echo at its handshake.

partial · [`plugins/connector-driver`](../plugins/connector-driver/README.md)

### Driver process

A supervised child process that controls or reads equipment, speaking JSON-RPC over its standard streams. The process port starts it. Its events enter as ingest commands.

partial · [`plugins/connector-driver`](../plugins/connector-driver/README.md) [`plugins/process`](../plugins/process/README.md)

### Driver SDK

A library in another language that implements the driver protocol for a driver author: bridge-mode gating, once-per-effect delivery with a journal, events and stubs generated from the driver contract. Each SDK proves itself against the reference contract in `plugins/connector-driver`.

partial · [`sdks/driver-python`](../sdks/driver-python/README.md) [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md)

### Effect

An [outbox effect](#outbox-effect).

### Effect completion

Recording a system of record's outcome for one effect, accepted or rejected, through the target's complete command. See [`packages/integration`](../packages/integration/README.md), [systems of record](systems-of-record.md).

### Embedded mode

Running the instance inside the calling process: a CLI call or an MCP bridge with `--embedded`, or a phone that opens its own workspace.

### Example

A hypothetical application under `showcase/examples/` used to demonstrate a composition of framework capabilities. Its invented requirements do not define framework behavior.

### Exchange folder

A directory the application exchanges files through with another system, declared by ID with its access and data classes. See [`packages/contracts`](../packages/contracts/README.md), [security and compliance](security-and-compliance.md#declarations).

### Execution context

Who is calling, in which workspace, under which grant, through which channel and with which cancellation signal. For an agent, also the run. The host supplies it; a channel never builds it from caller input.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/adapters`](../packages/adapters/README.md)

### Execution host

An isolation boundary and credential broker for tools an agent runs.

partial · [`plugins/execution-host`](../plugins/execution-host/README.md) [`plugins/process`](../plugins/process/README.md) [`plugins/network`](../plugins/network/README.md)

### Extractor

Turns one frame, such as a screen capture or a driver's state read, into readings with a confidence and a provenance. See [`packages/observation`](../packages/observation/README.md).

### Feature

A reusable domain part an application mounts once, such as approval requests: modules under one operation namespace, a state slice, handlers, a policy, hooks and optional connections. The policy reads an access view the application supplies. A host plugin is a feature with ports, a lifecycle and settings.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md) [`packages/kernel`](../packages/kernel/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/frame-native`](../packages/frame-native/README.md) [`packages/testing`](../packages/testing/README.md)

### Fencing token

A number that grows with each new holder of a worker claim or a workspace lease. See [`packages/runtime`](../packages/runtime/README.md), [`packages/adapters`](../packages/adapters/README.md).

### Fleet

The service implementing the enrolled-instance protocol for health reporting and release distribution, with optional audit forwarding and remote-access relay. See [Deployment and operation](hosting.md#fleet).

### Fleet agent

An instance's outbound-only link to a fleet: health reports (outbox backlog by target, best-before date), audit forwarding, verified release staging and a remote-access relay that adds no credential.

partial · [`plugins/fleet-agent`](../plugins/fleet-agent/README.md)

### Framework

The domain-neutral packages under `packages/` that applications compose through their declared entrypoints.

### Framework release

The framework and plugin packages published together at one version, each with the dependencies its published files import. A check refuses an install with mixed versions.

implemented · [`scripts/release.ts`](../scripts/release.ts) [`scripts/check-manifests.ts`](../scripts/check-manifests.ts) [`scripts/local-registry.ts`](../scripts/local-registry.ts) [`packages/scaffold/src/versions.ts`](../packages/scaffold/src/versions.ts) [`.changeset`](../.changeset)

### Generator

A pure transformation from the catalog to a reference document. `bun run generate` writes the documents to `dist/reference/`, outside version control.

implemented · [`scripts/generate.ts`](../scripts/generate.ts) [`scripts/reference-artifacts.ts`](../scripts/reference-artifacts.ts)

### Golden test

A replay of labeled inputs through a station profile and its extractors. It runs before a station profile change or a model change goes into use.

implemented · [`workstations/screen-bridge`](../workstations/screen-bridge/README.md)

### Grant

The permission a caller acts under: the capabilities, resources and expiry it may use, bound to a principal and a workspace. See [`packages/runtime`](../packages/runtime/README.md), [authorization](authorization.md).

### Grant file

A JSON declaration of the principal and permitted capabilities for an embedded caller, optionally constrained by resources and expiry. See [`packages/adapters`](../packages/adapters/README.md).

### Handler

The server function that implements one capability.

### Hardening profile

The floor a deployment policy sets for identity, delegated grants, audit and network access: `desktop-local`, `hub`, `sandbox` or `zero-trust`. See [security and compliance](security-and-compliance.md#deployment-policy).

### Harness

The adapter that runs one model turn for an agent run and returns its tool calls and output. See [`packages/agents`](../packages/agents/README.md), [agents](agents.md).

### Host

The domain-neutral process that opens an instance for one application definition on a host platform.

implemented · [`packages/kernel`](../packages/kernel/README.md) [`packages/host`](../packages/host/README.md) [`packages/mobile`](../packages/mobile/README.md)

### Host component

A part of the host, such as the audit forwarder or a screen bridge, that declares its own requirements with `defineHostComponent`. See [`packages/contracts`](../packages/contracts/README.md).

### Host platform

What the composition needs from the machine it runs on — workspace ownership, storage and the host's own components — and which of sockets, child processes, ingress and folders the machine offers.

partial · [`packages/kernel`](../packages/kernel/README.md) [`packages/host`](../packages/host/README.md) [`packages/mobile`](../packages/mobile/README.md)

### Host plugin

A cross-cutting part an application composes: a feature with ports, settings and lifecycle hooks.

implemented · [`packages/kernel`](../packages/kernel/README.md) [`packages/host`](../packages/host/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/mobile`](../packages/mobile/README.md) [`plugins/managed-config`](../plugins/managed-config/README.md)

### Hosted instance

The Bun host on the hosted platform: the workspace in a shared Postgres database, ownership as a workspace lease, and TLS ingress with workforce sign-in from the deployment policy. See [hosting](hosting.md#hosted-instance).

### Hub

The instance that phones and tablets pair with and deliver to, usually the host on the local network under the `hub` hardening profile. See [mobile](mobile.md).

### Idempotency key

A caller-supplied key under which the runtime retains a command result. A matching replay can return that result without rerunning the handler while it remains within retention. See [Versions and idempotency](interaction-contract.md#versions-and-idempotency).

### Inbound sync

Importing a system of record's changes as ordinary commands.

implemented · [`packages/integration`](../packages/integration/README.md)

### Input source

Device input normalized into events and routed to a command without a model turn.

implemented · [`packages/devices`](../packages/devices/README.md) [`plugins/intent-scanner`](../plugins/intent-scanner/README.md)

### Instance

One application opened on one workspace, and while open its only writer. It executes the workspace's commands and queries.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/kernel`](../packages/kernel/README.md) [`packages/adapters`](../packages/adapters/README.md)

### Instructions

What an assignee receives with an assignment: the kind's instructions schema, computed from the scope when the caller sends the assignment, unchanged after.

### Integration allowlist

A policy rule that recognizes one integration principal and lists the only capabilities it may call. See [`packages/runtime`](../packages/runtime/README.md), [`packages/integration`](../packages/integration/README.md).

### Integration principal

The narrow principal the dispatcher and inbound sync run as.

### Journal

The ordered entries describing committed resource changes. See [Journal and live query](#journal-and-live-query).

### Journal and live query

The ordered record of committed changes, and the client code that follows it.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/client`](../packages/client/README.md) [`packages/react`](../packages/react/README.md)

### Launch link

The URL a host prints as `launchUrl`, with a one-use key after `#launch=`. The page posts the key to `/api/v1/session` and gets the session cookie; this launch link sign-in is how a browser gets its session. See [`packages/adapters`](../packages/adapters/README.md), [`packages/frame`](../packages/frame/README.md).

### Live query

A query maintained by following changes after its snapshot cursor. See [Operations and state](capability-authoring.md#live-queries).

### Local user

The principal `local-user`: the person who runs the application on their own machine and gets a session and connection file where the identity policy allows it. See [`packages/kernel`](../packages/kernel/README.md).

### Manifest

The browser-safe entrypoint of an application or host plugin: its ID, title, modules and host components. See [`packages/kernel`](../packages/kernel/README.md).

### Membership

Roles that people have in a container: a work order, plant or station.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md)

### Model entry

A model the model server may serve, named by the digests of its base weights, its adapter and the dataset that tuned the adapter. The model server starts it only after the weights match their digests and a fine-tune has passed its gate.

implemented · [`packages/agents`](../packages/agents/README.md) [`plugins/model-server`](../plugins/model-server/README.md) [`packages/testing`](../packages/testing/README.md)

### Module

The unit a domain contributes to the catalog: capabilities, requirement declarations, OS declarations, workflows and agent definitions, declared with `defineModule`. The application definition or host plugin that composes it supplies the handlers, the state slice and the policy.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md)

### Native frame

The domain-neutral React Native UI around one application's native screens.

partial · [`packages/frame-native`](../packages/frame-native/README.md) [`apps/mobile`](../apps/mobile/README.md)

### Nested call

A command or query that another command's handler runs inside the same transaction. The runtime authorizes each on its own.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/contracts`](../packages/contracts/README.md)

### Network guard

The path from server code, and from declared child processes, to the network. `bun run check:boundaries` fails a direct network call outside the reviewed exemptions in `scripts/boundary-rules.ts`.

implemented · [`plugins/network`](../plugins/network/README.md) [`scripts/boundary-rules.ts`](../scripts/boundary-rules.ts)

### Observation

A reading an ingest command submits from a source that answers no query.

implemented · [`packages/observation`](../packages/observation/README.md) [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) [`plugins/connector-driver`](../plugins/connector-driver/README.md) [`plugins/connector-mqtt`](../plugins/connector-mqtt/README.md) [`plugins/connector-opcua`](../plugins/connector-opcua/README.md)

### Operator

A person who works at a workstation, usually under an `operator` role the application declares.

### Operator input

Input from a person at a workstation, such as a scan, a key press or a touch, on the station PC or a phone next to the equipment. See [operator input](operator-input.md), [`packages/operator-ui`](../packages/operator-ui/README.md).

### OS action

A declared request to the operating system to open a URL, reveal or open a file, share, notify or send an Android intent, with the data classes it includes.

partial · [`packages/contracts`](../packages/contracts/README.md) [`packages/shell`](../packages/shell/README.md) [`plugins/os`](../plugins/os/README.md) [`plugins/share-target`](../plugins/share-target/README.md) [`plugins/notifications`](../plugins/notifications/README.md) [`plugins/android-intents`](../plugins/android-intents/README.md) [`plugins/compliance`](../plugins/compliance/README.md) [`packages/agents`](../packages/agents/README.md) [`apps/desktop`](../apps/desktop/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/frame-native`](../packages/frame-native/README.md) [`packages/mobile`](../packages/mobile/README.md)

### OS handler

A declared registration with the operating system: a link path, file type, share target, Android intent, shortcut or notification reply, and where its requests go.

partial · [`packages/contracts`](../packages/contracts/README.md) [`packages/shell`](../packages/shell/README.md) [`plugins/os`](../plugins/os/README.md) [`plugins/share-target`](../plugins/share-target/README.md) [`plugins/notifications`](../plugins/notifications/README.md) [`plugins/android-intents`](../plugins/android-intents/README.md) [`plugins/os-shortcuts`](../plugins/os-shortcuts/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/frame-native`](../packages/frame-native/README.md) [`packages/mobile`](../packages/mobile/README.md) [`plugins/compliance`](../plugins/compliance/README.md) [`apps/desktop`](../apps/desktop/README.md) [`apps/mobile`](../apps/mobile/README.md)

### Outbox

The part of the workspace that stores effects until the dispatcher delivers them. See [`packages/runtime`](../packages/runtime/README.md).

### Outbox effect

A recorded intent to change another system, committed with the command that causes it.

implemented · [`packages/runtime`](../packages/runtime/README.md)

### Pattern

A hypothetical application under `showcase/patterns/` that isolates a technical extension and composes the unchanged base application. See [Extension patterns](patterns.md).

### Peer

Another agent-native application enrolled with this one through the peer link. See [`plugins/peer-link`](../plugins/peer-link/README.md).

### Peer API

The commands and queries an application lets a peer call: those its service principal may call, and those a peer may call on behalf of a mapped person.

### Peer link

Enrollment of another agent-native application. Once enrolled, it calls the peer API as its service principal or, with a signed subject assertion, as a mapped person.

partial · [`plugins/peer-link`](../plugins/peer-link/README.md) [`packages/integration`](../packages/integration/README.md)

### Peer target

Another agent-native application as a target, through the peer API it publishes. The peer API exposes the commands and queries it lets a peer call as a service principal or on behalf of a mapped person.

partial · [`packages/contracts`](../packages/contracts/README.md) [`packages/integration`](../packages/integration/README.md)

### Person

A human caller authenticated through a host session.

### Plugin service

The object a host plugin exposes to later plugins and to handlers as `services[<plugin id>]`, such as the audit plugin's log directory and forwarder statistics. See [`packages/kernel`](../packages/kernel/README.md).

### Policy

The port that decides operation, object, row and field access.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/adapters`](../packages/adapters/README.md)

### Principal

The identity a caller acts as: a person, a device, the integration principal or an agent run's issuer. See [authorization](authorization.md).

### Procedure

A declared sequence of screen steps in a station profile that runs for one effect type. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md).

### Process port

The host port that starts declared child processes from the deployment policy's bindings. Its default refuses.

partial · [`packages/kernel`](../packages/kernel/README.md) [`packages/host`](../packages/host/README.md) [`plugins/deployment`](../plugins/deployment/README.md) [`plugins/process`](../plugins/process/README.md)

### Query

An authorized read that changes nothing.

implemented · [`packages/runtime`](../packages/runtime/README.md)

### Reconciliation

A tracked state and procedure for outcomes no one can establish automatically. The `reconciliation` feature serves the decisions.

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md) [`packages/integration`](../packages/integration/README.md) [`packages/frame`](../packages/frame/README.md)

### Release

Always qualified: releasing a held effect queues it for another delivery; releasing workspace ownership ends an instance's workspace lease.

### Remote query

A query that reads another system when the caller runs it, and stores nothing. The query acts with the caller's credential, or with a service credential where the query declares that fallback.

partial · [`packages/contracts`](../packages/contracts/README.md) [`packages/runtime`](../packages/runtime/README.md) [`packages/integration`](../packages/integration/README.md) [`packages/host`](../packages/host/README.md) [`packages/react`](../packages/react/README.md)

### Requirement declaration

A module or host component's declaration of an external resource it needs. Deployment policy supplies the environment-specific binding. See [Security and compliance](security-and-compliance.md#declarations).

implemented · [`packages/contracts`](../packages/contracts/README.md)

### Revision

The per-resource counter a command bumps. See [interaction contract](interaction-contract.md).

### Risk level

What a declared action can do to people or equipment. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Scaffold

Exports the framework, the starter and content as a standalone application, or the starter and a new application over installed framework versions. Also generates new applications and their parts.

implemented · [`packages/scaffold`](../packages/scaffold/README.md)

### Scanner profile

Schema-validated data describing how one scanner at one workstation reaches the application and how the decoder normalizes its output. See [`packages/devices`](../packages/devices/README.md), [operator input](operator-input.md).

### Screen

One routed part of an application's UI, declared in its `screens` entrypoint and bound to capabilities through the typed client. See [architecture](architecture.md#application-entrypoints).

### Screen bridge

The connector that reads a workstation application through its screen and runs declared procedures on it. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [operator workstations](operator-workstations.md).

### Screen recognizer

An extractor for screen captures in `workstations/screen-bridge/src/recognition`: the accessibility tree, a recognition worker process speaking JSON lines, or a vision model behind an OpenAI-compatible endpoint. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [operator workstations](operator-workstations.md).

### Session

What a host issues to an authenticated caller and derives the execution context from. See [`packages/adapters`](../packages/adapters/README.md).

### Shelf life

The days each build stays within its best-before date. The manifest declares it, the build stamps the build time, and a bundle signs the date. Hosts, `app status`, the compliance status and fleet health show it. The host refuses nothing after that date.

implemented · [`packages/kernel/src/build.ts`](../packages/kernel/src/build.ts) [`packages/bundle`](../packages/bundle/README.md) [`plugins/deployment/src/install`](../plugins/deployment/src/install) [`plugins/compliance`](../plugins/compliance/README.md) [`packages/frame`](../packages/frame/README.md)

### Shell port

The host port that receives OS requests and performs OS actions. Its default refuses both.

partial · [`packages/kernel`](../packages/kernel/README.md) [`packages/host`](../packages/host/README.md) [`packages/adapters`](../packages/adapters/README.md) [`packages/shell`](../packages/shell/README.md) [`packages/mobile`](../packages/mobile/README.md) [`plugins/os`](../plugins/os/README.md) [`apps/desktop`](../apps/desktop/README.md) [`apps/mobile`](../apps/mobile/README.md)

### Snapshot

One consistent read of a workspace at a journal cursor.

### Starter

The thin application host a team forks or generates and then owns: the one application named in `app.config.json`.

implemented · [`apps/service`](../apps/service/README.md) [`apps/web`](../apps/web/README.md) [`apps/desktop`](../apps/desktop/README.md) [`apps/mobile`](../apps/mobile/README.md) [`app.config.json`](../app.config.json)

### State migration

Numbered versions of an application's, each feature's and each plugin's state, with the steps between them, stamped per workspace. A feature can adopt data an older application version kept in its own state. Storage runs the steps when it loads a workspace. The `migrate` command runs them on a checked copy before it replaces the database.

implemented · [`packages/kernel/src/migrations.ts`](../packages/kernel/src/migrations.ts) [`packages/kernel/src/state-upgrade.ts`](../packages/kernel/src/state-upgrade.ts) [`packages/host/src/cli/migrate-command.ts`](../packages/host/src/cli/migrate-command.ts)

### Station and scanner profiles

Schema-validated data about one plant's equipment. A station profile has a version and describes one kind of workstation application. A scanner profile describes how one scanner at one workstation reaches the application.

implemented · [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) [`packages/devices`](../packages/devices/README.md)

### Station profile

Versioned data describing one kind of workstation application: how to recognize its screens and where each field appears and how to read it. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [operator workstations](operator-workstations.md).

### Storage

The port for the instance's transactional state. The memory, SQLite and Postgres adapters pass one conformance suite. The mobile host platform uses a snapshot adapter that keeps one JSON document per workspace.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/adapters`](../packages/adapters/README.md) [`packages/testing`](../packages/testing/README.md)

### Subject assertion

The signed `Tortoise-Subject` header with which a peer names the person a request is for. See [`plugins/peer-link`](../plugins/peer-link/README.md).

### Subject mapping

The called application's table from a peer's subject IDs to its own principals.

### Synced records

Local copies of external records imported through a target's sync command. See [Systems of record](systems-of-record.md#inbound-sync).

### System of record

Another system that owns records the application reads or changes, and that decides what it accepts. See [systems of record](systems-of-record.md).

### Target

A declaration of an external integration with its completion and status capabilities. An inbound declaration adds sync. The target also defines the narrow integration grant. See [Systems of record](systems-of-record.md#targets).

implemented · [`packages/contracts`](../packages/contracts/README.md) [`packages/integration`](../packages/integration/README.md)

### Telemetry

OpenTelemetry metrics and traces of commands, outbox delivery, backlog by target, and agent and job runs. The plugin derives them from the audit log and the outbox and exports them through the network guard without record contents.

partial · [`plugins/telemetry`](../plugins/telemetry/README.md)

### Terminal

A principal whose session may sign operators in at a workstation: the local user, or a principal listed in the `station-sign-in-terminals` setting, such as an attached tablet's. See [`workstations/sign-in`](../workstations/sign-in/README.md), [operator workstations](operator-workstations.md#workstation-sign-in).

### Tortoise

The framework and its supporting host packages in this project. Its hypothetical applications are maintained demonstration content.

### Trigger

Declared work that automation starts on a committed change or a schedule.

implemented · [`plugins/automation`](../plugins/automation/README.md)

### Trigger grant

A person's recorded, expiring permission for a trigger to act as that principal.

implemented · [`plugins/automation`](../plugins/automation/README.md)

### UI binding

The screen control a capability declares as its entry point, or the stated reason it has none. See [`packages/contracts`](../packages/contracts/README.md), [`packages/testing`](../packages/testing/README.md).

### UI intent

A request from an agent run to the screen it started from: open a resource, select one, fill a command's form for the person to submit, or ask for a review. See [`packages/contracts`](../packages/contracts/README.md), [`packages/adapters`](../packages/adapters/README.md).

### UI registry

Reusable screen parts published as registries over stock shadcn primitives.

implemented · [`packages/operator-ui`](../packages/operator-ui/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/frame-native`](../packages/frame-native/README.md) [`plugins/compliance`](../plugins/compliance/README.md) [`plugins/connector-driver`](../plugins/connector-driver/README.md)

### UI session context

What a person is looking at, captured for an agent run. The intents the run sends back go through the `ui.*` run tools.

implemented · [`packages/adapters`](../packages/adapters/README.md) [`packages/host`](../packages/host/README.md) [`packages/frame`](../packages/frame/README.md) [`packages/agents`](../packages/agents/README.md)

### Watermark

The target's opaque position after the last applied inbound batch, stored in the application's state. See [`packages/integration`](../packages/integration/README.md).

### Web frame

The domain-neutral browser UI around one application's screens.

implemented · [`packages/frame`](../packages/frame/README.md)

### Worker claim

The dispatch identity and expiry for an effect, protected by a fencing token. See [Worker claims](#worker-claims).

### Worker claims

Attempt identities, expirations and fencing tokens, so a stale worker cannot overwrite a newer outcome.

implemented · [`packages/runtime`](../packages/runtime/README.md) [`packages/integration`](../packages/integration/README.md)

### Workflow

Declared steps that run commands and wait on queries over hours or days, as the person who started them. Steps have retries and compensations.

partial · [`packages/contracts`](../packages/contracts/README.md) [`plugins/workflows`](../plugins/workflows/README.md)

### Workflow instance

One run of a declared workflow, which `workflow.start` starts and the workflows plugin's runner advances one step per command, as its starter under a grant narrowed to the workflow's operations. See [`plugins/workflows`](../plugins/workflows/README.md).

### Workforce sign-in

People signing in to a serving host through the workforce identity provider, under `identity: external`.

partial · [`plugins/deployment/src/workforce`](../plugins/deployment/src/workforce) [`packages/kernel/src/plugin.ts`](../packages/kernel/src/plugin.ts) [`packages/adapters/src/http`](../packages/adapters/src/http)

### Worklist

The assignee side of assignments in another application. It shows the open assignments from the issuer's inbound sync. It records reports and done marks locally and delivers them to the issuer through the outbox.

implemented · [`packages/assignments`](../packages/assignments/README.md) [`packages/frame-native`](../packages/frame-native/README.md)

### Workspace

The data one instance owns: state, revisions, command results, journal, outbox, blobs and plugin slices, at one path or in one database.

### Workspace lease

One instance's right to write a workspace, kept in a shared database, with a fencing token that every commit checks. A stalled holder cannot overwrite the instance that took the workspace over.

implemented · [`packages/adapters`](../packages/adapters/README.md) [`packages/host`](../packages/host/README.md)

### Workstation

A station PC or panel where operators work and sign in. See [operator workstations](operator-workstations.md).

### Workstation application

Software already running at a workstation that has no API and must stay unmodified. See [operator workstations](operator-workstations.md).

### Workstation sign-in

An operator signing in at a shared workstation terminal by badge and PIN, for a short-lived session issued to that operator.

partial · [`workstations/sign-in`](../workstations/sign-in/README.md) [`packages/kernel/src/plugin.ts`](../packages/kernel/src/plugin.ts)
