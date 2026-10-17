---
name: create-agent-native-app
description: Create a new agent-native application from this framework with `bun run scaffold new`, export a reference example, or decide which skill fits a change to an existing application. Use when starting an application, choosing between the examples, or shaping a generated application into the user's business domain.
---

# Create an agent-native application

Preserve the user's actual business domain. `scaffold new` exports the framework and a thin starter with a generated application as the only content, and `scaffold add` extends it with collections, capabilities and targets. Shaping those generated parts into the requested domain is authored work. `scaffold --example <name>` exports one reference example instead. With `--registry <url>` (or `--published` for npm's registry) the new application installs the framework packages at the checkout's version instead of copying their source; `bun run release:serve` serves them on loopback to try that before anything is published. Read [the setup reference](references/new-application.md) for the commands and what the export contains.

## Before writing

For a bounded task or workflow over existing systems of record, establish the real-world trigger, record ownership, the difference between capture and acceptance, and the exception path before shaping the UI. Ask only for choices that materially change the implementation. Use explicit ports for storage, identity, authorization and provider integration.

Pick the closest example as the pattern to read:

| Example | Shows |
| --- | --- |
| `examples/project-tasks` | the smallest whole application: capabilities, policy, OS handlers, agent definitions, a background job |
| `examples/quality-inspection` | capture against a system of record through the outbox, and a measuring instrument through a Python driver |
| `examples/crm-capture` | live search of a remote system and adoption of its records |
| `examples/line-station` | an operator workstation over station software reached through its screen or a .NET driver |
| `examples/asset-survey` and `examples/asset-survey-field` | a hub with blob evidence and a paired mobile field app |

## Which skill next

| Task | Skill |
| --- | --- |
| A command or query, a record shape, a trigger | `packages/runtime/skills/add-capability/SKILL.md` |
| Writes another system must accept, sync, live reads | `packages/integration/skills/connect-system-of-record/SKILL.md` |
| Screens and registry components | `packages/frame/skills/build-screens/SKILL.md` |
| A cross-cutting concern several applications compose | `packages/host/skills/write-host-plugin/SKILL.md` |
| Instruments and machines through a driver process | `plugins/connector-driver/skills/write-hardware-driver/SKILL.md` |
| Station software with no API, through its screen | `packages/station/skills/bridge-station-screen/SKILL.md` |
| Barcode scanners and point-of-work input | `packages/devices/skills/add-scanner-input/SKILL.md` |
| Share targets, shortcuts, intents, notifications | `packages/shell/skills/add-os-integration/SKILL.md` |
| The phone or tablet host, native plugins, pairing | `packages/mobile/skills/extend-mobile-host/SKILL.md` |
| Site policy, signed bundles, install on a machine | `plugins/site/skills/deploy-to-site/SKILL.md` |
| Which checks to run and how to report them | `packages/testing/skills/check-a-change/SKILL.md` |

AGENTS.md lists the same skills; `bun install` links them for Claude Code and Codex. In an application that installs the framework from a registry, these skills come from the installed packages under `node_modules/@agent-native/`, and the steps that change framework source apply in the framework checkout instead.

## Reporting

Run the checks the `check-a-change` skill names and report what actually passed. Generated source and deterministic tests do not establish provider login, live inference, native packaging, real hardware or a release. The [implementation status](../../../../docs/implementation-status.md) lists what has not been shown; report those gaps separately from scaffolding success. Do not reuse discovered credentials, publish a release or install global agent configuration as part of scaffolding.
