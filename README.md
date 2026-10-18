# Agent-native desktop starter

Desktop applications are the expert's tools again. A single-user application on the expert's own machine responds at once, works without a network, and composes with the other programs there, including the control software that runs equipment. Agent harnesses such as Claude Code and Codex run on the same machine and act through its CLIs and MCP servers. This repository is a reference architecture and [framework](docs/glossary.md#framework) for that paradigm. It provides reusable building blocks for agent-native, hyper-specialized applications for the edge workforce. People and agents operate each application together, and it delivers their work to the [systems of record](docs/systems-of-record.md) that own enterprise data, such as an ERP, a quality system or an MES.

## Capabilities and surfaces

Each [command](docs/glossary.md#command) or [query](docs/glossary.md#query) is declared once as a [capability](docs/glossary.md#capability). The composed [catalog](docs/glossary.md#catalog) drives HTTP, MCP, the CLI and typed React calls from the [screens](docs/glossary.md#screen). Each of these is a [surface](docs/glossary.md#surface). The [generators](docs/glossary.md#generator) read the same catalog to write the reference documents.

People, agents, scripts and devices call the same capabilities with the same validation and authorization. A change committed through any surface reaches every open screen through the [journal](docs/glossary.md#journal).

## Hosts

The Bun [host](docs/glossary.md#host) keeps the [workspace](docs/glossary.md#workspace) in SQLite by default and serves the React screens. Electron wraps it on the desktop. The mobile host, built with Expo, runs an [application](docs/glossary.md#application) on Android and iOS.

## Layers and packages

The repository has these parts:

- the framework in `packages/*`;
- workstation packages in `workstations/*`;
- host plugins in `plugins/*`;
- the starter in `apps/*`, which hosts the one application named in `app.config.json`;
- the examples in `examples/*`;
- driver SDKs for other languages in `sdks/*`.

## First run

Install Bun 1.4.0, the version `package.json` pins. Dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

The desktop window opens on `project-tasks`, the application `app.config.json` names. Create a project, add a task, then choose **Create tasks from brief**. A deterministic [harness](docs/glossary.md#harness) turns each line of the brief into a command and needs no provider account.

## Verification

```sh
bun run check
bun run test:e2e
bun run test:scaffold
```

The standalone scaffold acceptance run and the platform checks are in [Development and testing](docs/development-and-testing.md).

The framework includes ChatGPT plan connection code, Claude execution with an API key and AI SDK execution. Provider credentials pay for inference and give no access to a workspace. Live sign-in and inference, provider eligibility and signed platform distribution each need their own check. Deterministic protocol tests do not establish those results. [Providers](docs/providers.md) has the details.

## Scope

The framework is local-first. A [hosted instance](docs/hosting.md#hosted-instance) keeps its workspace in a shared Postgres database under a [workspace lease](docs/glossary.md#workspace-lease). Managed cloud hosting, multi-device synchronization, more than one application per instance, publication to a public registry and signed distribution are outside the framework.

Each [storage](docs/glossary.md#storage) transaction receives the whole workspace state in memory, and the CPU time of a commit grows with that state (`packages/adapters/src/row-storage.ts`). A large application may need a storage design that does not load the whole workspace. The storage port imposes no record model on module state. [Architecture](docs/architecture.md#storage) describes the storage adapters.

## Guides

- [Overview](docs/overview.md)
- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Primitives](docs/primitives.md)
- [Glossary](docs/glossary.md)
- [Capability authoring](docs/capability-authoring.md), [interaction contract](docs/interaction-contract.md), [authorization](docs/authorization.md) and [state and reactivity](docs/state-and-reactivity.md)
- [Adapters](docs/adapters.md)
- [Systems of record](docs/systems-of-record.md)
- [Operator workstations](docs/operator-workstations.md)
- [Point-of-work input](docs/point-of-work-input.md)
- [Hardware drivers](docs/hardware-drivers.md)
- [Agents](docs/agents.md) and [providers](docs/providers.md)
- [Hosting](docs/hosting.md)
- [Desktop](docs/desktop.md)
- [Mobile](docs/mobile.md)
- [Security and compliance](docs/security-and-compliance.md)
- [Implementation status](docs/implementation-status.md) and its [known defects](docs/implementation-status.md#known-defects)
