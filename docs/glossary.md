# Glossary

One line per term, alphabetical. Two pairs differ in ways that matter: a *target* names an integration and a *destination* binds its network access; the *journal* records committed changes and the *audit log* records operations and denials.

## Terms

### Action checks

The checks a connector passes before it acts on a screen or on equipment: the bridge mode, who has control or local control, and a readback that confirms the result. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [`plugins/connector-driver`](../plugins/connector-driver/README.md).

Do not use: interlock.

### Adapter

An implementation of a framework port, such as the SQLite storage adapter or the CASL authorization adapter. See [`packages/adapters`](../packages/adapters/README.md).

### Agent definition

A named agent in the catalog: its instructions, the capabilities it may call, the commands it requests approval for, the resource types it works on, its model requirement, its output mode and its budgets. See [`packages/contracts`](../packages/contracts/README.md), [`packages/runtime`](../packages/runtime/README.md).

### Agent run

One run of an agent, acting as one more caller on the catalog under a grant narrowed from its issuer's. See [`packages/agents`](../packages/agents/README.md), [agents](agents.md).

### Agent scenario

A test of an agent definition: a task, fixture state and the commits, approval requests and refusals it expects. See [`packages/testing`](../packages/testing/README.md).

### Application

One unit of content that a host runs: a browser-safe manifest, an application definition and screens, with their tests. See [architecture](architecture.md#application-entrypoints).

### Application definition

The server entrypoint of an application, declared with `defineApplication` from [`packages/kernel`](../packages/kernel/README.md).

### Approval dataset

The approval requests people approved, rejected or let expire, exported as training data. See [`packages/runtime`](../packages/runtime/README.md).

### Approval request

A command that one caller, usually an agent run, asks a person to approve before it runs. See [`packages/runtime`](../packages/runtime/README.md), [agents](agents.md).

### Assignee

Who takes an assignment: a person, an agent definition, a paired device, a peer or an assignment target. See [`packages/assignments`](../packages/assignments/README.md).

### Assignment

Work that a caller hands to an assignee with a brief, and the reports the assignee sends back. See [`packages/assignments`](../packages/assignments/README.md), [assignments](assignments.md).

### Assignment kind

The declaration of one kind of assignment: the scope a planner fills in, the brief, one report's body and subject, the reviewer's accept input, and the assignee types that may take it.

### Assignment report

One result an assignee sends back on an assignment, under an ID the reporter chose. See [`packages/assignments`](../packages/assignments/README.md).

### Attached mode

Running a CLI, MCP bridge, desktop window or phone against an instance that another process owns, through a session that instance issued. See [architecture](architecture.md#instances-and-hosts).

### Audit log

The hash-chained, tamper-evident record of commands, queries, denials, outbox transitions, sync passes, connections and agent runs. See [`plugins/audit`](../plugins/audit/README.md), [security and compliance](security-and-compliance.md#audit-log).

### Behavioral scenario

A reusable test of one capability: permitted and denied access, a stale revision, a replayed idempotency key, and the change visible to another caller. See [`packages/testing`](../packages/testing/README.md).

### Best-before date

The last day a build is within its [shelf life](#shelf-life): the build date plus the shelf life, in UTC. See [`packages/kernel`](../packages/kernel/README.md), [application lifecycle](application-lifecycle.md#shelf-life-and-best-before-date).

### Blob

Content-addressed bytes, such as a photo or a document, that a command references from a resource. See [`packages/runtime`](../packages/runtime/README.md).

### Bridge mode

How far a screen bridge or a driver bridge may act. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Brief

What an assignee receives with an assignment: the kind's brief schema, computed from the scope when the caller sends the assignment, unchanged after. See [`packages/assignments`](../packages/assignments/README.md).

### Bundle

One signed, versioned directory per application and platform, which an install checks before it places the release. Do not use: site bundle. See [`packages/bundle`](../packages/bundle/README.md), [`plugins/deployment`](../plugins/deployment/README.md).

### Caller

The source of a command or query: a person at a screen, an agent run, a script, a trigger, a device or the dispatcher.

### Capability

A command or query declared once as data with `defineCapability`: its operation ID, input and output schemas, permission and UI binding. See [`packages/contracts`](../packages/contracts/README.md), [capability authoring](capability-authoring.md).

### Catalog

The composed, validated description of everything an application can do. See [`packages/contracts`](../packages/contracts/README.md).

### Channel

The surface a request came through, as recorded in the execution context and in audit records: `direct`, `http`, `mcp`, `cli`, `embedded`, `integration`, `harness`, `host` or `shell`. See [`packages/contracts`](../packages/contracts/README.md).

### Collection

A typed set of records a module keeps in its state slice, with generated get and list queries. See [`packages/runtime`](../packages/runtime/README.md).

### Command

An authorized write that every caller submits the same way. See [`packages/runtime`](../packages/runtime/README.md), [state and reactivity](state-and-reactivity.md).

### Compensation

The command a declared workflow step names to undo it. See [`plugins/workflows`](../plugins/workflows/README.md).

### Compliance bundle

The evidence an auditor checks: the security manifest and data flows, a control mapping, a CycloneDX SBOM and a posture monitor. See [`plugins/compliance`](../plugins/compliance/README.md).

### Composition

The portable layer that composes an application and its plugins, resolves the host ports and opens one instance. See [`packages/kernel`](../packages/kernel/README.md).

### Connection file

A private JSON file with a loopback endpoint and a bearer token, which the host writes as `.connection.json` in the workspace directory. See [`packages/adapters`](../packages/adapters/README.md), [`packages/host`](../packages/host/README.md).

### Connector

An implementation of the system-of-record port for one target. See [`packages/integration`](../packages/integration/README.md), [systems of record](systems-of-record.md).

### Container

A work order, plant, workstation or other unit that people have roles in. See [`packages/runtime`](../packages/runtime/README.md), [authorization](authorization.md).

### Continuation

A command a handler asks for with `continueWith`, run after the handler's frame as a [nested call](#nested-call) in the same transaction under the same context. See [`packages/runtime`](../packages/runtime/README.md).

### Control

Who controls a workstation application's screen: `operator`, `agent` for the screen bridge, or `idle`. The bridge control reports it as `controlledBy`. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [operator workstations](operator-workstations.md#control).

Do not use: control holder.

### Credential vault

The port for provider secrets, kept by the instance only. See [`packages/agents`](../packages/agents/README.md), [providers](providers.md).

### Cursor

A position in the journal. See [`packages/runtime`](../packages/runtime/README.md).

### Data provider

One declaration of a kind of record that lives in a system of record and that callers search there live. See [`packages/contracts`](../packages/contracts/README.md), [`packages/integration`](../packages/integration/README.md).

### Decommissioning

Removing an application from a machine after its [systems of record](#system-of-record) store every record it captured. See [`plugins/deployment`](../plugins/deployment/README.md), [application lifecycle](application-lifecycle.md#decommissioning-procedure).

### Delivery mode

How a driver action avoids acting twice. See [`plugins/connector-driver`](../plugins/connector-driver/README.md), [hardware drivers](hardware-drivers.md).

### Delivery outcome

What one delivery attempt returns to the dispatcher. See [`packages/integration`](../packages/integration/README.md), [systems of record](systems-of-record.md).

### Deployment policy

The policy one host runs under. Do not use: site policy. See [`plugins/deployment`](../plugins/deployment/README.md), [security and compliance](security-and-compliance.md#deployment-policy).

### Destination

A network endpoint that a module, host component or child process declares by ID, with its direction, scope, protocol and data classes. See [`packages/contracts`](../packages/contracts/README.md), [security and compliance](security-and-compliance.md#declarations).

### Device

A paired phone or tablet, identified as `device:<id>`, or a hardware device a module declares. See [mobile](mobile.md), [hardware drivers](hardware-drivers.md).

### Device link

Pairing a phone or tablet with a hub. See [`plugins/device-link`](../plugins/device-link/README.md).

### Dispatcher

The worker that claims queued, retrying and acknowledged effects, delivers them through the connector outside any transaction, and records each outcome under the integration principal. See [`packages/integration`](../packages/integration/README.md), [systems of record](systems-of-record.md).

### Display metadata

What a capability declares about how screens show it and its records: a label, the resource kind its records name, their key, title field and shown fields. See [`packages/contracts`](../packages/contracts/README.md).

### Driver

A supervised child process that controls or reads equipment, speaking JSON-RPC over its standard streams, which the process port starts. See [`plugins/connector-driver`](../plugins/connector-driver/README.md), [hardware drivers](hardware-drivers.md).

### Driver contract

The browser-safe description of one driver: its state fields, its actions with delivery mode and risk level, its events, and what it needs from the deployment. See [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Driver SDK

A library in another language that implements the driver protocol for a driver author: bridge-mode gating, a journal for `once` actions, events, and stubs generated from the driver contract. See [`sdks/driver-python`](../sdks/driver-python/README.md), [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md).

### Effect

A durable intent to change another system, committed with the command that causes it; the dispatcher delivers it later. See [`packages/runtime`](../packages/runtime/README.md), [systems of record](systems-of-record.md).

### Effect completion

Recording a system of record's outcome for one effect, accepted or rejected, through the target's complete command. See [`packages/integration`](../packages/integration/README.md), [systems of record](systems-of-record.md).

### Embedded mode

Running the instance inside the calling process: a CLI call or an MCP bridge with `--embedded`, or a phone that opens its own workspace.

### Example

A whole application under `showcase/examples/` for a real-world case in one of the covered domains, such as field service work orders or goods receiving.

### Exchange folder

A directory the application exchanges files through with another system, declared by ID with its access and data classes. See [`packages/contracts`](../packages/contracts/README.md), [security and compliance](security-and-compliance.md#declarations).

### Execution context

Who is calling, in which workspace, under which grant, through which channel, and with which cancellation. See [`packages/runtime`](../packages/runtime/README.md).

### Execution host

Runs the tools an agent uses in Linux bubblewrap sandboxes. See [`plugins/execution-host`](../plugins/execution-host/README.md).

### Extractor

Turns one frame, such as a screen capture or a driver's state read, into readings with a confidence and a provenance. See [`packages/observation`](../packages/observation/README.md).

### Feature

A reusable domain part an application mounts once, such as approval requests: modules whose operations start with the feature's ID, a state slice under that ID, handlers and a policy. See [architecture](architecture.md#features-and-host-plugins).

### Feed

The inbound side of a target: the item schema, the most items one batch may include, and the records a batch changes. See [`packages/contracts`](../packages/contracts/README.md).

### Fencing token

A number that grows with each new holder of a worker claim or a workspace lease. See [`packages/runtime`](../packages/runtime/README.md), [`packages/adapters`](../packages/adapters/README.md).

### Fleet

An application that enrolled instances report to: enrollment, health, signed releases, forwarded audit events and relayed remote access. See [`showcase/examples/fleet`](../showcase/examples/fleet/README.md), [`plugins/fleet-agent`](../plugins/fleet-agent/README.md).

### Framework

The domain-neutral packages under `packages/`.

### Framework release

The framework, workstation and plugin packages published together at one version. See [development and testing](development-and-testing.md).

### Generator

A pure transformation from the catalog to a reference document.

### Golden test

Replays labeled frames through a station profile and its extractors and reports per-field accuracy and confidence. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md).

### Grant

The permission a caller acts under: the capabilities, resources and expiry it may use, bound to a principal and a workspace. See [`packages/runtime`](../packages/runtime/README.md), [authorization](authorization.md).

### Grant file

A JSON file an orchestrator writes for a process it starts: the principal, the capabilities and optionally the resources, expiry and workspace. See [`packages/adapters`](../packages/adapters/README.md), [systems of record](systems-of-record.md).

### Handler

The server function that implements one capability.

### Hardening profile

The floor a deployment policy sets for identity, delegated grants, audit and network access: `desktop-local`, `hub`, `sandbox` or `zero-trust`. See [security and compliance](security-and-compliance.md#deployment-policy).

### Harness

The adapter that runs one model turn for an agent run and returns its tool calls and output. See [`packages/agents`](../packages/agents/README.md), [agents](agents.md).

### Host

The process that opens an instance for one application on a host platform and serves it: the Bun host behind the desktop and browser, or the mobile host. See [`packages/host`](../packages/host/README.md), [`packages/mobile`](../packages/mobile/README.md).

### Host component

A part of the host, such as the audit forwarder or a screen bridge, that declares its own requirements with `defineHostComponent`. See [`packages/contracts`](../packages/contracts/README.md).

### Host platform

What the composition needs from the machine: workspace ownership, storage, a blob store, an optional secret store and the host's own components. See [`packages/kernel`](../packages/kernel/README.md).

### Host plugin

A cross-cutting part an application composes: a feature with ports, settings and lifecycle hooks, and the same three entrypoints as an application. See [architecture](architecture.md#host-plugins).

### Hosted instance

The Bun host on the hosted platform: the workspace in a shared Postgres database, ownership as a workspace lease, and TLS ingress with workforce sign-in from the deployment policy. See [hosting](hosting.md#hosted-instance).

### Hub

The instance that phones and tablets pair with and deliver to, usually the host on the local network under the `hub` hardening profile. See [mobile](mobile.md).

### Idempotency key

The caller-chosen key that makes a repeated command return its first receipt instead of running again. See [interaction contract](interaction-contract.md).

### Inbound sync

Importing a system of record's changes as ordinary commands. See [`packages/integration`](../packages/integration/README.md).

### Input source

Device input, such as a scan, normalized into events and routed to a capability without a model turn. See [`packages/devices`](../packages/devices/README.md), [operator input](operator-input.md).

### Instance

One application opened on one workspace: its plugins and ports, storage, the runtime and the integrations. See [`packages/kernel`](../packages/kernel/README.md), [`packages/runtime`](../packages/runtime/README.md).

### Integration allowlist

A policy rule that recognizes one integration principal and lists the only capabilities it may call. See [`packages/runtime`](../packages/runtime/README.md), [`packages/integration`](../packages/integration/README.md).

### Integration principal

The narrow principal the dispatcher and inbound sync run as.

### Journal

The ordered record of committed changes that live queries follow. See [`packages/runtime`](../packages/runtime/README.md), [state and reactivity](state-and-reactivity.md).

### Launch link

The URL a host prints as `launchUrl`, with a one-use key after `#launch=`. The page posts the key to `/api/v1/session` and gets the session cookie; this launch link sign-in is how a browser gets its session. See [`packages/adapters`](../packages/adapters/README.md), [`packages/frame`](../packages/frame/README.md).

Do not use: launch key exchange.

### Live query

A query a screen keeps current by following the journal. See [`packages/client`](../packages/client/README.md), [`packages/react`](../packages/react/README.md).

### Local user

The principal `local-user`: the person who runs the application on their own machine and gets a session and connection file where the identity policy allows it. See [`packages/kernel`](../packages/kernel/README.md).

Do not use: owner (principal).

### Manifest

The browser-safe entrypoint of an application or host plugin: its ID, title, modules and host components. See [`packages/kernel`](../packages/kernel/README.md).

### Membership

The roles people have in a container, which the framework keeps and the membership command changes. See [`packages/runtime`](../packages/runtime/README.md).

### Model entry

A model the model server may serve, named by an ID and the digest of its base weights.

### Module

The browser-safe unit a domain contributes to the catalog: capabilities, requirement declarations, OS declarations, workflows and agent definitions, declared with `defineModule`. See [`packages/contracts`](../packages/contracts/README.md).

### Nested call

A command or query that a handler runs with `ctx.invoke` or `ctx.query` inside its own command's transaction, under the same context. See [`packages/runtime`](../packages/runtime/README.md), [capability authoring](capability-authoring.md#nested-calls).

### Network guard

The path from server code and declared child processes to the network. See [`plugins/network`](../plugins/network/README.md).

Do not use: egress guard.

### Observation

A reading an ingest command submits from a source that answers no query: a broker topic, a controller tag or the screen of a workstation application. See [`packages/observation`](../packages/observation/README.md).

### Operator

A person who works at a workstation, usually under an `operator` role the application declares.

### Operator input

Input from a person at a workstation, such as a scan, a key press or a touch, on the station PC or a phone next to the equipment. See [operator input](operator-input.md), [`packages/operator-ui`](../packages/operator-ui/README.md).

Do not use: point of work.

### OS action

A declared request to the operating system to open a URL, reveal or open a file, share, notify or send an Android intent, with the data classes it includes. See [`packages/shell`](../packages/shell/README.md), [desktop](desktop.md).

### OS handler

A declared registration with the operating system, such as a link path, file type, share target, Android intent, shortcut or notification reply, and the capability its requests go to. See [`packages/shell`](../packages/shell/README.md).

### Outbox

The part of the workspace that stores effects until the dispatcher delivers them. See [`packages/runtime`](../packages/runtime/README.md).

### Pattern

A small application under `showcase/patterns/` that shows one technical concern, such as a system of record, an agent or a sandbox.

### Peer

Another agent-native application enrolled with this one through the peer link. See [`plugins/peer-link`](../plugins/peer-link/README.md).

### Peer API

The commands and queries an application lets a peer call: those its service principal may call, and those a peer may call on behalf of a mapped person.

### Peer link

Enrollment of, and calls between, two agent-native applications. See [`plugins/peer-link`](../plugins/peer-link/README.md), [systems of record](systems-of-record.md#peer-applications).

### Peer target

A target that is another agent-native application, declared with `definePeerTarget` from the peer API that application publishes.

### Person

A human caller: an operator, inspector, supervisor, auditor or local user at a screen or a workstation.

### Plugin service

The object a host plugin exposes to later plugins and to handlers as `services[<plugin id>]`, such as the audit plugin's log directory and forwarder statistics. See [`packages/kernel`](../packages/kernel/README.md).

### Policy

The port that decides operation, object, row and field access for a principal, built with `definePolicy` or the CASL adapter. See [`packages/runtime`](../packages/runtime/README.md), [authorization](authorization.md).

### Principal

The identity a caller acts as: a person, a device, the integration principal or an agent run's issuer. See [authorization](authorization.md).

### Procedure

A declared sequence of screen steps in a station profile that runs for one effect type. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md).

### Process port

The host port that starts declared child processes from the deployment policy's bindings. See [`plugins/process`](../plugins/process/README.md).

### Query

An authorized read of one snapshot that changes nothing and returns a cursor the caller can follow. See [`packages/runtime`](../packages/runtime/README.md).

### Receipt

The stored result of a command under its idempotency key: the outcome, the changed resources and any continuation. See [`packages/runtime`](../packages/runtime/README.md).

### Reconciliation

The tracked state and procedure for effects whose outcome no one can establish automatically. See [`packages/runtime`](../packages/runtime/README.md), [systems of record](systems-of-record.md).

### Release

Always qualified: releasing a held effect queues it for another delivery; releasing workspace ownership ends an instance's workspace lease.

### Remote query

A query that reads another system when the caller runs the query, and stores nothing. See [`packages/runtime`](../packages/runtime/README.md), [systems of record](systems-of-record.md).

### Requirement declaration

What a module, host component or plugin needs outside the process, as data: destinations, exchange folders, devices and child processes. See [security and compliance](security-and-compliance.md#declarations).

### Revision

The per-resource counter a command bumps. See [interaction contract](interaction-contract.md).

### Risk level

What a declared action can do to people or equipment. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [`plugins/connector-driver`](../plugins/connector-driver/README.md).

### Scaffold

The tool that exports the framework, the starter and content as a standalone application, or generates a new application and its parts. See [`packages/scaffold`](../packages/scaffold/README.md).

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

How many days each build of an application stays within its [best-before date](#best-before-date), declared in the manifest. See [`packages/kernel`](../packages/kernel/README.md), [application lifecycle](application-lifecycle.md#shelf-life-and-best-before-date).

### Shell port

The host port that receives OS requests under declared OS handlers and performs declared OS actions. See [`packages/kernel`](../packages/kernel/README.md).

### Snapshot

One consistent read of a workspace at a journal cursor.

### Starter

The thin application host a team forks or generates and then owns: `apps/service`, `apps/web`, `apps/desktop` and `apps/mobile`.

### State migration

Numbered versions of an application's and each plugin's state, with the steps between them, stamped per workspace. See [`packages/kernel`](../packages/kernel/README.md), [`packages/host`](../packages/host/README.md).

### Station profile

Versioned data describing one kind of workstation application: how to recognize its screens and where each field appears and how to read it. See [`workstations/screen-bridge`](../workstations/screen-bridge/README.md), [operator workstations](operator-workstations.md).

### Storage

The port for the instance's transactional state. See [`packages/runtime`](../packages/runtime/README.md), [`packages/adapters`](../packages/adapters/README.md).

### Subject assertion

The signed `Tortoise-Subject` header with which a peer names the person a request is for. See [`plugins/peer-link`](../plugins/peer-link/README.md).

### Subject mapping

The called application's table from a peer's subject IDs to its own principals.

### Surface

One way callers reach the catalog: the screens, HTTP, MCP, the CLI or the typed client. See [`packages/adapters`](../packages/adapters/README.md).

### Synced records

The copies of system-of-record records that an application keeps for its tasks, such as inspection lots or MES orders.

### System of record

Another system that owns records the application reads or changes, and that decides what it accepts. See [systems of record](systems-of-record.md).

### Target

The declaration of one system of record with `defineTarget`: its complete, sync and status commands and queries, the integration principal's capabilities and its integration allowlist.

### Telemetry

OpenTelemetry metrics and traces of commands, outbox delivery and backlog, and runs, derived from the audit log and the outbox. See [`plugins/telemetry`](../plugins/telemetry/README.md).

### Terminal

A principal whose session may sign operators in at a workstation: the local user, or a principal listed in the `station-sign-in-terminals` setting, such as an attached tablet's. See [`workstations/sign-in`](../workstations/sign-in/README.md), [operator workstations](operator-workstations.md#workstation-sign-in).

### Tortoise

The name of the project: the framework, workstation packages, host plugins, starter, examples, patterns and driver SDKs in this repository.

### Trigger

Work that starts on a committed change or a schedule instead of a person's prompt. See [`plugins/automation`](../plugins/automation/README.md).

### Trigger grant

A person's recorded, expiring permission for a trigger to act as that principal. See [`plugins/automation`](../plugins/automation/README.md).

### UI binding

The screen control a capability declares as its entry point, or the stated reason it has none. See [`packages/contracts`](../packages/contracts/README.md), [`packages/testing`](../packages/testing/README.md).

### UI intent

A request from an agent run to the screen it started from: open a resource, select one, fill a command's form for the person to submit, or ask for a review. See [`packages/contracts`](../packages/contracts/README.md), [`packages/adapters`](../packages/adapters/README.md).

### UI registry

Reusable screen parts published as shadcn registries over stock shadcn primitives, which an application copies with `shadcn add` and then owns.

### UI session context

The selection and observed revisions a screen shares with an agent run, which the host checks against authorized queries and freezes when the run captures it. See [`packages/adapters`](../packages/adapters/README.md), [authorization](authorization.md).

### Watermark

The target's opaque position after the last applied feed batch, stored in the application's state. See [`packages/integration`](../packages/integration/README.md).

### Web frame

The domain-neutral browser shell around one application's screens: session, routing, palette, run panel, assistant panel and accounts. See [`packages/frame`](../packages/frame/README.md), [`packages/frame-native`](../packages/frame-native/README.md).

### Worker claim

The dispatcher's claim on one effect: a worker name, an expiry and a fencing token. See [`packages/runtime`](../packages/runtime/README.md).

### Workflow

A sequence of capabilities a module declares for agents: prose `text` with the operations it names, and, when declared with `defineWorkflow`, steps that run a command or wait on a query, with their bindings, retries, timeouts and compensations. See [`packages/contracts`](../packages/contracts/README.md).

### Workflow instance

One run of a declared workflow, which `workflow.start` starts and the workflows plugin's runner advances one step per command, as its starter under a grant narrowed to the workflow's operations. See [`plugins/workflows`](../plugins/workflows/README.md).

### Workforce sign-in

People signing in to a serving host through the workforce identity provider under `identity: external`. See [`plugins/deployment`](../plugins/deployment/README.md).

### Worklist

The assignee side of assignments in another application, such as a phone or a peer.

### Workspace

The data one instance owns: state, revisions, receipts, journal, outbox, blobs and plugin slices, at one path or in one database.

### Workspace lease

One instance's right to write a hosted workspace, kept in the shared database with a fencing token that every commit checks. See [`packages/adapters`](../packages/adapters/README.md), [hosting](hosting.md).

### Workstation

A station PC or panel where operators work and sign in. See [operator workstations](operator-workstations.md).

### Workstation application

Software already running at a workstation that has no API and must stay unmodified. See [operator workstations](operator-workstations.md).

### Workstation sign-in

An operator signing in at a workstation by badge and PIN, for a short-lived session issued to that operator. See [`workstations/sign-in`](../workstations/sign-in/README.md).
