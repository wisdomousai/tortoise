# Agent-native desktop starter

This checkout holds a TypeScript [framework](docs/glossary.md#framework), [host plugins](docs/glossary.md#host-plugin), a [starter](docs/glossary.md#starter) and [examples](docs/glossary.md#example). They build applications that people and AI agents operate together, often on or next to the machines where work happens. An application captures work locally and delivers it to the [systems of record](docs/systems-of-record.md) that own enterprise data. An evaluator reads this page to decide whether the framework fits a problem.

## Capabilities and surfaces

Each [command](docs/glossary.md#command) or [query](docs/glossary.md#query) is declared once as a [capability](docs/glossary.md#capability). The composed [catalog](docs/glossary.md#catalog) drives HTTP, MCP, the CLI and typed React calls from the [screens](docs/glossary.md#screen). Each of these is a [surface](docs/glossary.md#surface). The [generators](docs/glossary.md#generator) read the same catalog to write the reference documents.

People, agents, scripts and devices call the same capabilities with the same validation and authorization. A change committed through any surface reaches every open screen through the [journal](docs/glossary.md#journal).

## Hosts

The Bun [host](docs/glossary.md#host) keeps the [workspace](docs/glossary.md#workspace) in SQLite by default and serves the React screens. Electron wraps it on the desktop. The mobile host, built with Expo, runs an [application](docs/glossary.md#application) on Android and iOS.

## Layers and packages

The checkout has these layers:

- the framework in `packages/*`;
- host plugins in `plugins/*`;
- the starter in `apps/*`, which hosts the one application named in `app.config.json`;
- the examples in `examples/*`.

Driver SDKs for other languages sit beside them in `sdks/*`. [Architecture](docs/architecture.md#packages) lists the framework packages, and its [examples](docs/architecture.md#examples) section lists the eight examples. `bun run check:readmes` checks that every package, plugin, app, example and SDK has a README titled with its package name and that its links work. Each README states its trust boundary and how to run its tests.

## First run

Install Bun 1.4.0, the version `package.json` pins. Dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

The desktop window opens on `project-tasks`, the application `app.config.json` names. Create a project, add a task, then choose **Create tasks from brief**. A deterministic [harness](docs/glossary.md#harness) turns each line of the brief into a command and needs no provider account.

[Getting started](docs/getting-started.md) continues with the browser, the other examples, the CLI and MCP.

## Verification

```sh
bun run check
bun run test:e2e
bun run test:scaffold
```

[Development and testing](docs/development-and-testing.md) lists the full standalone scaffold acceptance run and the platform checks. [Implementation status](docs/implementation-status.md) separates local checks from live provider and native OS evidence.

The framework includes ChatGPT plan connection code, Claude execution with an API key and AI SDK execution. Provider credentials pay for inference and give no access to a workspace. Live sign-in and inference, provider eligibility and signed platform distribution each need their own check. Deterministic protocol tests do not establish those results. [Providers](docs/providers.md) has the details.

## Scope

The framework is local-first. A [hosted authority](docs/hosting.md#hosted-authority) keeps its workspace in a shared Postgres database under a [workspace lease](docs/glossary.md#workspace-lease). Managed cloud hosting, multi-device synchronization, more than one application per authority, publication to a public registry and signed distribution are outside the framework.

Each [storage](docs/glossary.md#storage) transaction receives the whole workspace state in memory, and the CPU time of a commit grows with that state (`packages/adapters/src/row-storage.ts`). A large application may need a storage design that does not load the whole workspace. The storage port imposes no record model on module state. [Architecture](docs/architecture.md#storage) describes the storage adapters.

## Guides

- [Getting started](docs/getting-started.md): run the examples, use them through the CLI and MCP, and create another application.
- [Architecture](docs/architecture.md): layers, surfaces, request flow, authorities and hosts, host plugins, storage and the invariants the checks test.
- [Primitives](docs/primitives.md): the building blocks, their status and where they live.
- [Glossary](docs/glossary.md): the terms every page uses.
- [Capability authoring](docs/capability-authoring.md), [interaction contract](docs/interaction-contract.md), [authorization](docs/authorization.md) and [state and reactivity](docs/state-and-reactivity.md): writing a capability and what callers can rely on.
- [Adapters](docs/adapters.md): the ports and their reference adapters.
- [Systems of record](docs/systems-of-record.md): outbox, inbound sync, remote queries and the CLI, as `quality-inspection`, `crm-capture` and `receiving` use them.
- [Operator workstations](docs/operator-workstations.md): station software reached through its screen, as `line-station` uses it.
- [Point-of-work input](docs/point-of-work-input.md): scanners and glove-sized screens.
- [Hardware drivers](docs/hardware-drivers.md): equipment reached through a driver process.
- [Agents](docs/agents.md) and [providers](docs/providers.md): agent runs, harnesses and provider accounts.
- [Hosting](docs/hosting.md): the hosted authority and the fleet.
- [Desktop](docs/desktop.md): the Electron window, its packaged resources and the build.
- [Mobile](docs/mobile.md): the mobile host, pairing with a hub and the device's trust boundary.
- [Security and compliance](docs/security-and-compliance.md): declared egress under a site policy, hardening profiles, the audit log and the compliance bundle.
- [Implementation status](docs/implementation-status.md): what has been run, what has not, and the [known defects](docs/implementation-status.md#known-defects).
