# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is the [framework](docs/glossary.md#framework) in this repository. The [starter](docs/glossary.md#starter) runs the one [application](docs/glossary.md#application) named in `app.config.json`.

## Application

An application is that program. It has:

- screens
- commands
- the records those commands change

## Host

The [host](docs/glossary.md#host) is the process that runs the application. It accepts the same commands from:

- the desktop window
- the browser
- the CLI
- MCP
- HTTP

Server code reaches the network only through the host. It starts a child process only through the host. It reads and writes an [exchange folder](docs/glossary.md#exchange-folder) only through the host. An exchange folder is a directory shared with another system.

`app serve`, the CLI and the MCP bridge run the application with no window. In [embedded mode](docs/glossary.md#embedded-mode), the MCP bridge runs the application over stdio. It listens on no network port.

The Bun host serves the React screens. Electron wraps that host on the desktop. The mobile host, built with Expo, runs an application on Android and iOS.

## Workspace

A [workspace](docs/glossary.md#workspace) is the application's data. The host stores it by default as a SQLite database in one directory.

One process holds an OS lock on that file and writes it. That process is the [instance](docs/glossary.md#instance). Other programs connect to the instance.

A second process that opens the file for writing is refused with `CONFLICT`. Two processes cannot commit to one SQLite file.

## Commands

A [command](docs/glossary.md#command) is a write. A [query](docs/glossary.md#query) is a read. The application declares each one once, as a [capability](docs/glossary.md#capability).

Each caller uses that declaration. The host checks validation and authorization the same way for each call.

The [catalog](docs/glossary.md#catalog) is the set of those declarations. The host generates these [surfaces](docs/glossary.md#surface) from the catalog:

- HTTP
- MCP
- the CLI
- typed React calls from the [screens](docs/glossary.md#screen)

The [generators](docs/glossary.md#generator) read the catalog and write the reference documents.

A committed change reaches every open screen through the [journal](docs/glossary.md#journal). The journal is the record of committed commands.

## Other systems

A [system of record](docs/systems-of-record.md) decides whether it accepts a change. A system of record is one of:

- an ERP
- a quality system
- an MES

A command that updates one of them writes the local record and an [outbox effect](docs/glossary.md#effect) in one transaction. An outbox effect is the record of that change, kept for sending. The [dispatcher](docs/glossary.md#dispatcher) sends the effect after the commit.

## Site

A [site](docs/glossary.md#site) is a plant, an office, or a customer location where the host runs under a [deployment policy](docs/glossary.md#deployment-policy).

The deployment policy is a file. It lists what the host may use:

- destinations
- folders
- programs

The host refuses anything the file does not list.

A desktop install runs on one person's computer. It can use a local policy.

## Builds

The [manifest](docs/glossary.md#manifest) sets a [shelf life](docs/glossary.md#shelf-life) as a number of days. A production build records the time it was built. The [best-before date](docs/glossary.md#best-before-date) is the build date plus the shelf life. The host shows that date. Commands still run after the date.

## Layers and packages

- the framework in `packages/*`
- workstation packages in `workstations/*`
- host plugins in `plugins/*`
- the starter in `apps/*`, which runs the one application named in `app.config.json`
- the examples in `showcase/examples/*`, whole applications for real-world cases
- the patterns in `showcase/patterns/*`, one technical concern each on an oil lab's test requests for power transformers in service
- driver SDKs for other languages in `sdks/*`

## First run

Install Bun 1.4.4, the version `package.json` pins. Dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

The desktop window opens on `field-service`, the application `app.config.json` names. Create a work order, add a task, then choose **Create tasks from brief**. A deterministic [harness](docs/glossary.md#harness) turns each line of the brief into a command and needs no provider account.

## Verification

```sh
bun run check
bun run test:e2e
bun run test:scaffold
```

The framework includes:

- ChatGPT plan connection code
- Claude execution with an API key
- AI SDK execution

`bun run check` does not run:

- live sign-in and inference
- provider eligibility
- signed platform distribution

## Scope

The host stores the workspace on one computer. The file stays on that computer. The framework does not copy a workspace to another device.

A [hosted instance](docs/hosting.md#hosted-instance) keeps its workspace in a shared Postgres database under a [workspace lease](docs/glossary.md#workspace-lease).

These are outside the framework:

- managed cloud hosting
- more than one application per instance
- publication to a public registry
- signed distribution

The framework records none of these for an application:

- an owner
- a term
- an approval

A release past its best-before date keeps running.

The `sandbox` [hardening profile](docs/security-and-compliance.md#hardening-profiles) refuses plain HTTP off the host. It requires a fail-closed [audit log](docs/glossary.md#audit-log). An audit log is the record of commands and denials. An embedded instance can run in a sandbox container. That container's only egress is the system of record.

Each [storage](docs/glossary.md#storage) transaction receives the whole workspace state in memory. The CPU time of a commit grows with that state (`packages/adapters/src/row-storage.ts`). A large application may need a storage design that does not load the whole workspace. The storage port imposes no record model on module state.

## Guides

- [Overview](docs/overview.md)
- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Primitives](docs/primitives.md)
- [Glossary](docs/glossary.md)
- [Capability authoring](docs/capability-authoring.md)
- [Interaction contract](docs/interaction-contract.md)
- [Authorization](docs/authorization.md)
- [State and reactivity](docs/state-and-reactivity.md)
- [Adapters](docs/adapters.md)
- [Systems of record](docs/systems-of-record.md)
- [Operator workstations](docs/operator-workstations.md)
- [Point-of-work input](docs/point-of-work-input.md)
- [Hardware drivers](docs/hardware-drivers.md)
- [Agents](docs/agents.md)
- [Providers](docs/providers.md)
- [Hosting](docs/hosting.md)
- [Application lifecycle](docs/application-lifecycle.md)
- [Desktop](docs/desktop.md)
- [Mobile](docs/mobile.md)
- [Security and compliance](docs/security-and-compliance.md)
- [Implementation status](docs/implementation-status.md)
- [Known defects](docs/implementation-status.md#known-defects)

## References

- [Providers](docs/providers.md)
- [Development and testing](docs/development-and-testing.md)
- [Architecture](docs/architecture.md#storage)
