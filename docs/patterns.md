# Patterns

The patterns show how to add a particular capability to a small working application. They share an oil lab at a power-transformer manufacturer: a technician submits a test request for an oil sample, and another technician assigns the test method. The [base application](../showcase/patterns/base/README.md) contains the request records, screens and technician/viewer policy.

Each other pattern imports those parts unchanged and adds one concern. Start with the base to see the work, then choose a pattern for the interaction you want to build. The [examples](architecture.md#examples) are larger applications that combine several concerns around a complete task.

## Choose a pattern

| Pattern | What to try | Port |
| --- | --- | --- |
| [Base](../showcase/patterns/base/README.md) | Submit a request, assign a method and see revisions and role checks. | 4350 |
| [System of record](../showcase/patterns/system-of-record/README.md) | Publish a request to a fake LIMS; observe acceptance, rejection and a held outcome. | 4351 |
| [Agents](../showcase/patterns/agents/README.md) | Request a method suggestion and have a technician approve it. | 4352 |
| [Host plugin](../showcase/patterns/host-plugin/README.md) | Count committed lab activity with a plugin that owns its own state. | 4353 |
| [Operations](../showcase/patterns/operations/README.md) | Migrate an older workspace and export telemetry to a stand-in collector. | 4354 |
| [Review](../showcase/patterns/review/README.md) | Add a reusable second-person review to a request. | 4355 |
| [Signals](../showcase/patterns/signals/README.md) | Watch fake OPC UA and MQTT readings change a chamber's condition. | 4356 |
| [Local model](../showcase/patterns/local-model/README.md) | Run the method suggester through a measured model server or its stand-in. | 4357 |
| [Sign-in](../showcase/patterns/sign-in/README.md) | Sign in at a shared bench with a badge and PIN, then act as that operator. | 4358 |
| [Site](../showcase/patterns/site/README.md) | Connect the lab to a fleet, stage a signed release and inspect a staged install. | 4359 |
| [Sandbox](../showcase/patterns/sandbox/README.md) | Analyze lab readings with a tool confined to a Linux bubblewrap sandbox. | 4360 |
| [Hosted](../showcase/patterns/hosted/README.md) | Run the desk with a Postgres lease and a stand-in workforce identity provider. | 4361 |
| [Assignments](../showcase/patterns/assignments/README.md) | Send a sampling round and accept a report into a test request. | 4362 |
| [Worklist](../showcase/patterns/worklist/README.md) | Receive that round in a second application and return reports over a peer link. | 4363 |

Each page explains its setup, the work a person can try, the source files, checks and limits. The [primitives reference](primitives.md) maps the framework's building blocks to their implementations; the [overview](overview.md#layers-and-dependencies) shows workspace dependencies.

## How an extension uses the base

The base defines its request contract in `showcase/patterns/base/contracts.ts`, its state and handlers in `domain.ts` and `handlers.ts`, and access in `policy.ts`. The screens live in `ui/requests.tsx`.

An extension composes those parts in its own entrypoints:

1. The manifest includes the base module and the extension's module, feature or plugin manifest.
2. The server mounts the base handlers on the `testRequests` slice and routes each module to its policy. An extension that needs lab membership can supply an access view over the application state.
3. The screens reuse the base routes and navigation. An extension can add a section to the request screen without editing the base.

The [review pattern](../showcase/patterns/review/README.md) is a small example: the review feature owns signatures, while the lab supplies the access view that identifies the request's author and the technicians who can review it.

## Run and check

Run a pattern from its directory, or test it from the repository root:

```sh
cd showcase/patterns/agents
bun run dev:web
```

```sh
bun test showcase/patterns/agents
bun test showcase/patterns
```

Development launches that need an outside system generally start a stand-in: for example, `system-of-record` starts a fake LIMS, `signals` starts fake plant endpoints and `operations` can start a collector stand-in. The relevant README names the setup and how to trigger a failure. The `hosted` pattern instead needs Postgres and a trusted local certificate for its browser sign-in; `sandbox` requires Linux with bubblewrap for the confined-tool path.

The pattern tests and the two Playwright suites for `assignments` and `worklist` do not establish a live provider, real plant, production fleet or device run. [Implementation status](implementation-status.md) records those separate kinds of evidence and known gaps.
