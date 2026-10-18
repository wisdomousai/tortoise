---
name: create-agent-native-app
description: Create a new agent-native application from this framework with `bun run scaffold new`, export a reference example, or decide which skill fits a change to an existing application. Use when starting an application, choosing between the examples, or shaping a generated application into the user's business domain.
---

# Create an agent-native application

The [scaffold](../../../../docs/glossary.md#scaffold) starts an [application](../../../../docs/glossary.md#application) and its parts. `scaffold new` exports the framework and a thin [starter](../../../../docs/glossary.md#starter) with a generated application as the only content. `scaffold add` extends it with collections, capabilities, targets and proposing agents. `scaffold --example <name>` exports one reference [example](../../../../docs/glossary.md#example) instead. [The setup reference](references/new-application.md) has the commands and what the export contains, and [getting started](../../../../docs/getting-started.md#new-application) shows a first run.

## Before writing

- Preserve the business domain the person actually asked for. Shaping the generated parts into the requested domain is authored work.
- For a bounded task or workflow over existing [systems of record](../../../../docs/glossary.md#system-of-record), establish these before shaping the UI:
  - the real-world trigger;
  - record ownership;
  - the difference between capture and acceptance;
  - the exception path.
- Ask only for choices that materially change the implementation.
- Use explicit ports for storage, identity, authorization and provider integration.
- Do not reuse discovered credentials, publish a release or install global agent configuration as part of scaffolding.

## Steps

1. Pick the closest example from the table below and read it as the pattern.
2. Export the application with `scaffold new`, or one example with `scaffold --example <name>`, as [the setup reference](references/new-application.md) describes.
3. To install the framework packages at the checkout's version instead of copying their source, pass `--registry <url>`, or `--published` for npm's registry.
4. To try a registry install before anything is published, serve the packages on loopback with `bun run release:serve`.
5. Extend the application with `scaffold add`.
6. Shape the generated parts into the requested domain.
7. Pick the skill for each further change from the second table below.

| Example | Shows |
| --- | --- |
| `examples/project-tasks` | the smallest whole application: capabilities, policy, OS handlers, agent definitions, a background job |
| `examples/quality-inspection` | capture against a system of record through the outbox, and a measuring instrument through a Python driver |
| `examples/crm-capture` | live search of a CRM and adoption of its records |
| `examples/line-station` | an operator workstation over station software reached through its screen or a .NET driver |
| `examples/asset-survey` and `examples/asset-survey-field` | a hub with blob evidence and a paired mobile field application |

| Task | Skill |
| --- | --- |
| A command or query, a record shape, a trigger | `packages/runtime/skills/add-capability/SKILL.md` |
| Writes another system must accept, sync, live reads | `packages/integration/skills/connect-system-of-record/SKILL.md` |
| Screens and registry components | `packages/frame/skills/build-screens/SKILL.md` |
| A cross-cutting concern several applications compose | `packages/host/skills/write-host-plugin/SKILL.md` |
| Instruments and machines through a driver process | `plugins/connector-driver/skills/write-hardware-driver/SKILL.md` |
| Tools an agent runs, confined in a sandbox | `plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md` |
| A model on this host, base or fine-tuned | `plugins/model-server/skills/serve-a-local-model/SKILL.md` |
| Station software with no API, through its screen | `packages/station/skills/bridge-station-screen/SKILL.md` |
| Barcode scanners and point-of-work input | `packages/devices/skills/add-scanner-input/SKILL.md` |
| Share targets, shortcuts, intents, notifications | `packages/shell/skills/add-os-integration/SKILL.md` |
| The phone or tablet host, native plugins, pairing | `packages/mobile/skills/extend-mobile-host/SKILL.md` |
| Site policy, signed bundles, install on a machine | `plugins/site/skills/deploy-to-site/SKILL.md` |
| A hosted instance with its workspace in Postgres | `packages/host/skills/run-a-hosted-authority/SKILL.md` |
| A site that reports to a fleet, or the fleet it reports to | `plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md` |
| Metrics and traces in an observability backend | `plugins/telemetry/skills/export-telemetry/SKILL.md` |
| Which checks to run and how to report them | `packages/testing/skills/check-a-change/SKILL.md` |

AGENTS.md lists the same skills, and `bun install` links them for Claude Code and Codex. An application that installs the framework from a registry gets these skills from the installed packages under `node_modules/@agent-native/`. There, the steps that change framework source apply in the framework checkout instead.

## Checks

Run the checks the `check-a-change` skill names and report what actually passed. Generated source and deterministic tests do not establish provider login, live inference, native packaging, real hardware or a release. The [implementation status](../../../../docs/implementation-status.md) lists what has not been shown. Report those gaps separately from scaffolding success.
