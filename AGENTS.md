# Working on this starter

Tortoise is a framework for small applications that run at the edge and serve a process so specialized that no standard application fits it. Adapting a standard application to such a process costs as much as writing custom software, and Claude Code or Codex now writes custom software cheaply. But what it writes from scratch is fragile: whether the application checks access, keeps an audit log or gets its results into the central systems depends on what the prompts happened to ask for. Tortoise gives Claude Code or Codex a starting point that already does those things and runs on the computer or phone at the edge, so it writes only the code for the process.

Read `docs/overview.md`, `docs/architecture.md` and `docs/primitives.md` before you change a boundary.

## Layers

| Layer        | Path                                           | May import                                     |
| ------------ | ---------------------------------------------- | ---------------------------------------------- |
| framework    | `packages/*`                                   | framework only                                 |
| workstations | `workstations/*` (screen bridge, sign-in)      | framework only                                 |
| plugins      | `plugins/*`                                    | framework and the plugins it requires          |
| starter      | `apps/*`                                       | framework; hosts the app in `app.config.json`  |
| content      | `showcase/examples/*`, `showcase/patterns/*`   | framework, workstations, plugins               |
| driver SDKs  | `sdks/*`                                       | no application; nothing imports an SDK         |

- The framework and the starter name no domain and import no workstation package, plugin, example or pattern.
- An example is a whole application for a real case in a covered domain. A pattern is a small application that shows one technical concern. Every pattern imports `showcase/patterns/base` unchanged and adds one concern.
- An application has three entrypoints: browser-safe `manifest`, server `application`, browser `screens`. Its domain code, fakes, screens and tests stay in it. Framework tests never import one.
- A cross-cutting concern (deployment policy, network, audit, compliance) is a host plugin with `plugin-manifest`, `plugin` and `plugin-screens` entrypoints that the application lists. It reaches the network, ingress, identity and audit log through host ports, and writes only through its own commands.
- Generic host or frame behavior goes in the framework, so a forked starter keeps getting it.
- A driver SDK implements the driver protocol from `plugins/connector-driver` and proves itself against that plugin's reference contract.

## Invariants

These protect data and security. `bun run check` and the conformance suites test them.

- Contracts are browser-safe. Handlers, React components, scenarios and provider code live in separate entrypoints.
- Every change to records is a command the instance executes. A transport or harness never writes records itself.
- Authorize operation, object and fields inside the transaction. Filter rows before paging or counting. Recheck delegated grants and event access.
- Server code reaches the network only through the network port and starts child processes only through the process port.
- The host generates MCP, API, schema and reference docs from the catalog when it serves or builds them. Commit nothing generated. `bun run generate` writes the reference to `dist/reference/`.

## Guidance

Advice. Depart from it when the code is better for it, and say why in the commit message.

- Look for an existing primitive before you add one.
- A new primitive, plugin or integrated technology gets a pattern or example and a row in `docs/patterns.md`. Stay in the covered domains: manufacturing, field service, customer service, logistics, lab controls, industrial automation HMIs and APIs, test and quality.
- Move a domain concept into the framework when a second application needs it. Reusable UI ships as a shadcn registry built from stock primitives.
- `check:size` lists long files and functions as hints. Split a module by responsibility.
- An operation usually gets a behavioral scenario and a UI binding.
- Hand work to a person, device, agent, peer or service as an assignment, and take results back as reports a person accepts. Use an outbox effect when another system decides.
- An application serves one process. Keep its code to that process.
- Deliver what it captures through a target. Set a shelf life on the manifest.
- Do not add an owner, a term or a renewal record.
- Document what a workspace is for, what it trusts and how to test it. Comment the non-obvious: transaction and authorization order, trust boundaries, failure behavior.
- When a primitive's meaning or status changes, update `docs/primitives.md`. `docs/implementation-status.md` records only what `bun run check` cannot show (browser, device, live and by-hand runs) and known gaps.

## Skills

Skills are task guides for Claude Code and Codex, in `<workspace>/skills/<name>/` of the workspace they describe, so they ship in that package. An application's own skills go in its workspace or a root `skills/<name>/`. `bun install` links them into `.claude/skills/` and `.agents/skills/` (not committed). After adding or renaming a skill, run `bun run skills:link`.

| Task | Skill |
| --- | --- |
| Start an application, export an example, pick the next skill | [create-agent-native-app](packages/scaffold/skills/create-agent-native-app/SKILL.md) |
| Add or change a command or query, a record shape or a trigger | [add-capability](packages/runtime/skills/add-capability/SKILL.md) |
| Write or mount a feature: a reusable domain part with its slice, policy and hooks | [write-a-feature](packages/host/skills/write-a-feature/SKILL.md) |
| Hand out work and review the reports: assignment kinds, assignee types, the worklist | [assign-work](packages/assignments/skills/assign-work/SKILL.md) |
| Write a host plugin for a cross-cutting concern | [write-host-plugin](packages/host/skills/write-host-plugin/SKILL.md) |
| Choose the checks and report the evidence | [check-a-change](packages/testing/skills/check-a-change/SKILL.md) |
| Connect a system of record: outbox, complete, sync, live reads | [connect-system-of-record](packages/integration/skills/connect-system-of-record/SKILL.md) |
| Build screens and registry components | [build-screens](packages/frame/skills/build-screens/SKILL.md) |
| Bridge a workstation application through its screen | [bridge-station-screen](workstations/screen-bridge/skills/bridge-station-screen/SKILL.md) |
| Sign operators in at a shared terminal: badge, PIN, operator session, badge enrollment | [sign-in-at-a-terminal](workstations/sign-in/skills/sign-in-at-a-terminal/SKILL.md) |
| Add scanner and operator input | [add-scanner-input](packages/devices/skills/add-scanner-input/SKILL.md) |
| Add OS handlers, actions and native registrations | [add-os-integration](packages/shell/skills/add-os-integration/SKILL.md) |
| Extend the mobile host: native plugins, pairing | [extend-mobile-host](packages/mobile/skills/extend-mobile-host/SKILL.md) |
| Read plant signals from MQTT, Sparkplug B or OPC UA | [observe-plant-signals](packages/observation/skills/observe-plant-signals/SKILL.md) |
| Declare a durable workflow: steps, waits, compensations, the runner | [declare-a-workflow](plugins/workflows/skills/declare-a-workflow/SKILL.md) |
| Connect two agent-native applications: peer API, peer target, enrollment, subject mapping | [connect-two-applications](plugins/peer-link/skills/connect-two-applications/SKILL.md) |
| Write a hardware driver | [write-hardware-driver](plugins/connector-driver/skills/write-hardware-driver/SKILL.md) |
| Run agent tools in a sandbox: bubblewrap, grants, network guard | [run-agent-tools-in-a-sandbox](plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md) |
| Serve a local or fine-tuned model: entries, digests, datasets, the gate | [serve-a-local-model](plugins/model-server/skills/serve-a-local-model/SKILL.md) |
| Deploy an application: policy, signed bundles, install | [deploy-an-application](plugins/deployment/skills/deploy-an-application/SKILL.md) |
| Decommission an application: shelf life, drain, purge, fleet removal | [decommission-an-application](plugins/deployment/skills/decommission-an-application/SKILL.md) |
| Run a hosted instance: Postgres storage, the workspace lease, TLS and workforce sign-in | [run-a-hosted-instance](packages/host/skills/run-a-hosted-instance/SKILL.md) |
| Connect an instance to a fleet: enrollment, reports, audit forwarding, release staging, relay | [connect-an-instance-to-a-fleet](plugins/fleet-agent/skills/connect-an-instance-to-a-fleet/SKILL.md) |
| Export OpenTelemetry metrics and traces | [export-telemetry](plugins/telemetry/skills/export-telemetry/SKILL.md) |

Keeping skills current:

- Name a skill for a task, uniquely across the repo. The owning workspace's README links it and this table lists it.
- `scripts/skill-coverage.json` maps each package, workstation, plugin and SDK to its skills, or to an empty `skills` array with a `reason`. Include a workspace's own skills.
- An application that installs the framework from a registry has no coverage file or public API stamp. If it adds a local workspace, create its coverage registry and review and stamp that API.
- `bun run check:skills` validates the registry, discovery, links and paths. Update coverage when a workspace or skill changes.
- `scripts/reviewed-api.json` records each workspace's entrypoints, exported names and the root scripts as of the last review. When that public API changes, the check names the skills to review. Update them in the same commit, then run `bun run skills:stamp <workspace>`.
- A new extension point that other code uses and no skill covers gets a skill in its workspace.
- When two skills repeat steps, keep them in the owning package's skill and link from the other.
- Link to docs and READMEs instead of copying. Every path a skill names must exist.

## Working practice

- For current library APIs: `npx ctx7@latest library <name> '<question>'`, then `npx ctx7@latest docs <id> '<question>'`. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`.
- Follow `docs/styleguide.md` and use the terms in `docs/glossary.md`.
- Do not discover or reuse provider credentials. Live probes need explicitly configured accounts. Never commit keys, data directories or generated launch credentials.
- Concurrent agents own disjoint files, announce interface changes and preserve each other's work. The root owns dependency manifests and the lockfile.
- Keep platform-specific cloud dependencies out of framework contracts and the runtime.
