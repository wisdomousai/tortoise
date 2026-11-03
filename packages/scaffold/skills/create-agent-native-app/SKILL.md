---
name: create-agent-native-app
description: Create a new agent-native application from this framework with `bun run scaffold new`, export a reference example, or decide which skill fits a change to an existing application. Use when starting an application, choosing between the examples, or shaping a generated application into the user's business domain.
---

# Create an agent-native application

The scaffold starts an application and its parts. `scaffold new` exports the framework and a thin starter with a generated application as the only content. `scaffold add` extends it with collections, capabilities, targets, requesting agents, assignment kinds and features. `scaffold --example <name>` exports one reference example instead.

## Before writing

- For a bounded task or workflow over existing systems of record, establish these before shaping the UI:
  - the real-world trigger;
  - record ownership;
  - the difference between capture and acceptance;
  - the exception path.
- An application does one task at one site. Keep its code to that task.
- Deliver what it captures through a target. Set a shelf life on the manifest.
- Do not add any of these records:
  - an owner
  - a term
  - a renewal
- Do not reuse discovered credentials, publish a release or install global agent configuration as part of scaffolding.

## Steps

1. Pick the closest example from the table below and read it as the pattern.
2. Export the application with `scaffold new`, or one example with `scaffold --example <name>`, as [the setup reference](references/new-application.md) describes.
3. To install the framework packages at the checkout's version instead of copying their source, pass `--registry <url>`, or `--published` for npm's registry.
4. To try a registry install before anything is published, serve the packages on loopback with `bun run release:serve`.
5. Extend the application with `scaffold add`.
6. Shape the generated parts into the requested domain.
7. Set `shelfLifeDays` in the manifest to how long one build should serve before it is rebuilt or removed. The scaffold writes 180.
8. Pick the skill for each further change from `AGENTS.md` at the application root. The tutorials order those skills into a build, with a prompt per step.

| Example | Shows |
| --- | --- |
| `showcase/examples/field-service` | the smallest whole application: capabilities, policy, OS handlers and actions, agent definitions, a background job |
| `showcase/examples/quality-inspection` | capture against a system of record through the outbox, and a measuring instrument through a Python driver |
| `showcase/examples/crm-capture` | live search of a CRM and following its records |
| `showcase/examples/winding-line` | an operator workstation over workstation application reached through its screen or a .NET driver |
| `showcase/examples/asset-survey` and `showcase/examples/asset-survey-field` | a hub with blob evidence, a declared workflow, assignments and a paired mobile field application that takes them |
| `showcase/examples/receiving` | an application generated with `scaffold new` and `scaffold add`: a file exchange with an ERP, reconciliation and an agent that requests approval |
| `showcase/examples/fleet` | the fleet that sites report to: enrollment, signed releases on channels, audit forwarding and relayed access |
| `showcase/examples/tool-store` | the tool store tutorial's application: loans, a counter terminal with scanning and sign-in, repair orders to an EAM, a triage agent, cycle counts, a site deployment |
| `showcase/examples/parts-desk` | the parts desk tutorial's application: quotes and an assistant panel beside every screen, served from a local model |
| `showcase/patterns/*` | one concept each on an oil lab's test requests for power transformers in service, as `docs/patterns.md` lists them. Exports leave them out |

`bun install` links these skills for Claude Code and Codex. An application that installs the framework from a registry gets these skills from the installed packages under `node_modules/@agent-native/`. There, the steps that change framework source apply in the framework checkout instead.

## Checks

Run the checks the `check-a-change` skill names and report what actually passed. Report provider login, live inference, native packaging, real hardware and release as unchecked unless they ran.

## References

- [Setup reference](references/new-application.md)
- [Getting started](../../../../docs/getting-started.md#new-application)
- [Tutorials](../../../../docs/tutorials/index.md)
- [Implementation status](../../../../docs/implementation-status.md)
