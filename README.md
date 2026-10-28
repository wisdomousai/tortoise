# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is a TypeScript framework and reference architecture for applications built around specialized work at one site. A receiving team might need a process that fits its warehouse and ERP. A lab might need to record measurements from its own instruments. These applications run where the work happens, next to existing equipment and business systems. People and agents use them.

In the [receiving example](showcase/examples/receiving/README.md), the ERP sends a delivery notice to an inbox. An operator counts what arrived, records the reason for any discrepancy and submits a goods receipt. The screen sends the receipt to the [host](docs/glossary.md#host) as a [command](docs/glossary.md#command). The host runs the application and checks the operator's access.

The host commits the posting to the application's [workspace](docs/glossary.md#workspace), by default a directory with a SQLite database. In the same transaction, the host saves an [outbox effect](docs/glossary.md#effect), a durable instruction to deliver the receipt to the ERP. The workspace holds the posting while the ERP's decision is pending.

After the commit, the [dispatcher](docs/glossary.md#dispatcher) sends the effect through a connector. In this example, the connector writes the receipt as a file to a shared folder and reads the ERP's response from another. A complete command records whether the ERP accepted or rejected the receipt. If delivery is uncertain, the application holds the effect for a person to resolve.

An application declares its commands and queries once, as [capabilities](docs/glossary.md#capability) in a [catalog](docs/glossary.md#catalog). The framework exposes that catalog through HTTP, MCP and the CLI, checks screen bindings and generates reference documentation. People and agents call the same operations and pass the same validation and authorization checks. When a command changes a record, open screens refresh the affected reads.

## Running and deployment

The starter runs the application named in `app.config.json`. The Bun host serves its React screens, and Electron wraps the host for the desktop. The application can also run without a window. In [embedded mode](docs/glossary.md#embedded-mode), the MCP bridge opens an instance over stdio and listens on no network port. The mobile host runs applications on Android and iOS.

The first instance that opens a local workspace holds its OS lock. Clients can attach to that instance. A second process that opens the workspace for writing receives `CONFLICT`.

The application declares the resources it needs. A [deployment policy](docs/glossary.md#deployment-policy) binds each declared destination, program and shared folder to one available at the site. The host refuses access to any resource the policy does not permit. When the manifest sets a shelf life, each production build gets a [best-before date](docs/glossary.md#best-before-date). Commands continue to run after that date. The site decides when to replace or remove the application.

## Layers and packages

- the framework in `packages/*`
- workstation packages in `workstations/*`
- host plugins in `plugins/*`
- the starter in `apps/*`, which runs the one application named in `app.config.json`
- the examples in `showcase/examples/*`, whole applications for real-world cases
- the patterns in `showcase/patterns/*`: a base application for an oil lab's test requests on power transformers in service, and patterns that each add one technical concern to it
- driver SDKs for other languages in `sdks/*`

## Build an application

Start with the task and the people who do it. Decide what they capture, who may change it and whether another system must accept the result. Follow the [getting-started guide](docs/getting-started.md) to create an application, put those rules in place, and run and test it. The scaffold generates a working starting point. You adapt it to the actual work.

To study an existing application first, run one of the [examples](docs/getting-started.md#explore-an-example). Some examples use demo dependencies where noted. For example, the receiving tests simulate the ERP and do not verify a live installation.

## Verification

```sh
bun run check
bun run test:e2e
bun run test:scaffold
```

The framework includes code to connect a ChatGPT plan, to run Claude with an API key and to run models through the AI SDK. These checks do not verify live sign-in, inference, provider eligibility or signed platform distribution.

## Scope

The default host keeps the workspace on one computer. The framework does not copy a workspace to another device.

A [hosted instance](docs/hosting.md#hosted-instance) keeps its workspace in a shared Postgres database under a [workspace lease](docs/glossary.md#workspace-lease).

These are outside the framework:

- managed cloud hosting
- more than one application per instance
- publication to a public registry
- signed distribution

The framework records no owner, term, approval or renewal for an application.

The `sandbox` [hardening profile](docs/security-and-compliance.md#hardening-profiles) refuses plain HTTP off the host and requires a fail-closed [audit log](docs/glossary.md#audit-log). An embedded instance can run in a container; the deployment must separately enforce the container's network boundaries.

Each [storage](docs/glossary.md#storage) transaction receives the whole workspace state in memory. The CPU time of a commit grows with that state (`packages/adapters/src/row-storage.ts`). A large application may need a storage design that does not load the whole workspace. The storage port imposes no record model on module state.

## Where to go next

- **Start building:** [Getting started](docs/getting-started.md), the [library tutorial](docs/tutorial-library.md), or the longer [tool crib tutorial](docs/tutorial.md).
- **Understand the framework:** [Overview](docs/overview.md), [architecture](docs/architecture.md), [primitives](docs/primitives.md) and [glossary](docs/glossary.md).
- **Build an interaction:** [Capability authoring](docs/capability-authoring.md), [authorization](docs/authorization.md), [state and reactivity](docs/state-and-reactivity.md), and [systems of record](docs/systems-of-record.md).
- **Connect people and equipment:** [Agents](docs/agents.md), [assignments](docs/assignments.md), [operator workstations](docs/operator-workstations.md), [point-of-work input](docs/point-of-work-input.md) and [hardware drivers](docs/hardware-drivers.md).
- **Run and verify an application:** [Hosting](docs/hosting.md), [desktop](docs/desktop.md), [mobile](docs/mobile.md), [security and compliance](docs/security-and-compliance.md), and [development and testing](docs/development-and-testing.md).
- **Check the evidence:** [Implementation status and known gaps](docs/implementation-status.md). [AGENTS.md](AGENTS.md#skills) lists task guides for coding agents.
