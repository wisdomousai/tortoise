# Working on this starter

Read `docs/overview.md`, `docs/architecture.md` and `docs/primitives.md` before changing a boundary.

## Layers

The layers are **framework** `packages/*`, **workstations** `workstations/*`, **plugins** `plugins/*`, **starter** `apps/*` and **content** `examples/*` and `samples/*`. Driver SDKs for other languages sit beside them in `sdks/*`.

- The framework and the starter name no domain and import no workstation package, plugin, example or sample. The starter hosts the one application named in `app.config.json`.
- A sample in `samples/<name>` is a small application of the same shape. `samples/notes` is the base; every other sample imports it unchanged and adds one concern.
- An example is an application with a browser-safe `manifest` entrypoint, a server `application` entrypoint and a browser `screens` entrypoint. Its domain code, fakes, screens and tests stay in the example; framework tests never import one.
- A cross-cutting concern (deployment policy, network, audit, compliance) is a host plugin in `plugins/<name>`, with `plugin-manifest`, `plugin` and `plugin-screens` entrypoints that the application lists. A plugin imports the framework and the plugins it requires, reaches the network, ingress, identity and audit log through host ports, and writes only through its own commands.
- It imports the framework only. The screen bridge and workstation sign-in live there.
- Generic host or frame behavior goes in the framework, so a forked starter keeps receiving it.
- A driver SDK in `sdks/<language>` implements the driver protocol that `plugins/connector-driver` defines, and proves itself against that plugin's reference contract. Nothing else imports an SDK, so the host depends on no driver language, and an SDK imports no application.

## Invariants

These protect data and security; `bun run check` and the conformance suites test them.

- Contracts are browser-safe. Handlers, React components, scenarios and provider code live in separate entrypoints.
- Every change to the application's records is a command executed by the instance. A transport or harness never writes records itself.
- Authorize the operation, object and fields inside the transaction. Filter rows before paging or counting. Recheck delegated grants and event access.
- Server code reaches the network only through the network port, and starts child processes only through the process port.
- MCP, API, schema and reference docs are generated from the catalog when they are served or built. Nothing generated is committed; `bun run generate` writes the reference to `dist/reference/` for reading.

## Guidance

This section is advice; depart from it when the code is better for it, and say why in the commit message.

- Look for an existing primitive before adding one.
- Move a domain concept into the framework when a second application needs it. Reusable UI ships as a shadcn registry built from stock primitives.
- `check:size` lists long files and functions as hints. Split a module by responsibility.
- An operation usually gets a behavioral scenario and a UI binding.
- Each workspace has a README saying what it is for, what it trusts, and how to run its tests. Comment the non-obvious: transaction and authorization ordering, trust boundaries, failure behavior.
- When a primitive's meaning or status changes, update its entry in `docs/primitives.md`. `docs/implementation-status.md` records only what `bun run check` cannot show (browser, device, live and by-hand runs) and the known gaps; don't restate what tests prove.

## Skills

Skills are task guides for coding agents. Each lives in the workspace whose extension points it describes, in `<workspace>/skills/<name>/`, so it ships in that package and an application that installs the framework from a registry gets it from `node_modules`. An application's own skills go in its workspace or in a root `skills/<name>/`. `bun install` links them into `.claude/skills/` for Claude Code and `.agents/skills/` for Codex through the root `postinstall`; after adding or renaming a skill, run `bun run skills:link`. The links are not committed.

| Task | Skill |
| --- | --- |
| Start an application, export an example, pick the next skill | [create-agent-native-app](packages/scaffold/skills/create-agent-native-app/SKILL.md) |
| Add or change a command or query, a record shape or a trigger | [add-capability](packages/runtime/skills/add-capability/SKILL.md) |
| Write or mount a feature: a reusable domain part with its slice, policy and hooks | [write-a-feature](packages/host/skills/write-a-feature/SKILL.md) |
| Hand out work and review the reports: assignment kinds, lanes, the worklist | [assign-work](packages/assignments/skills/assign-work/SKILL.md) |
| Write a host plugin for a cross-cutting concern | [write-host-plugin](packages/host/skills/write-host-plugin/SKILL.md) |
| Choose the checks and report the evidence | [check-a-change](packages/testing/skills/check-a-change/SKILL.md) |
| Connect a system of record: outbox, settle, sync, live reads | [connect-system-of-record](packages/integration/skills/connect-system-of-record/SKILL.md) |
| Build screens and registry components | [build-screens](packages/frame/skills/build-screens/SKILL.md) |
| Bridge a workstation application through its screen | [bridge-station-screen](workstations/screen-bridge/skills/bridge-station-screen/SKILL.md) |
| Add scanner and point-of-work input | [add-scanner-input](packages/devices/skills/add-scanner-input/SKILL.md) |
| Add OS handlers, actions and native registrations | [add-os-integration](packages/shell/skills/add-os-integration/SKILL.md) |
| Extend the mobile host: native plugins, pairing | [extend-mobile-host](packages/mobile/skills/extend-mobile-host/SKILL.md) |
| Read plant signals from MQTT, Sparkplug B or OPC UA | [observe-plant-signals](packages/observation/skills/observe-plant-signals/SKILL.md) |
| Declare a durable workflow: steps, waits, compensations, the runner | [declare-a-workflow](plugins/workflows/skills/declare-a-workflow/SKILL.md) |
| Connect two agent-native applications: peer surface, peer target, enrollment, subject mapping | [connect-two-applications](plugins/peer-link/skills/connect-two-applications/SKILL.md) |
| Write a hardware driver | [write-hardware-driver](plugins/connector-driver/skills/write-hardware-driver/SKILL.md) |
| Run agent tools in a sandbox: bubblewrap, grants, egress | [run-agent-tools-in-a-sandbox](plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md) |
| Serve a local or fine-tuned model: entries, digests, datasets, the gate | [serve-a-local-model](plugins/model-server/skills/serve-a-local-model/SKILL.md) |
| Deploy to a site: policy, signed bundles, install | [deploy-to-site](plugins/site/skills/deploy-to-site/SKILL.md) |
| Run a hosted instance: Postgres storage, the workspace lease, TLS and workforce sign-in | [run-a-hosted-instance](packages/host/skills/run-a-hosted-instance/SKILL.md) |
| Connect a site to a fleet: enrollment, reports, audit forwarding, release staging, relay | [connect-a-site-to-a-fleet](plugins/fleet-agent/skills/connect-a-site-to-a-fleet/SKILL.md) |
| Export OpenTelemetry metrics and traces | [export-telemetry](plugins/telemetry/skills/export-telemetry/SKILL.md) |

How skills stay current with the code:

- A skill is named for a task, not a package, and names are unique across the repo. The owning workspace's README links it, and this table lists it.
- Every package, plugin and SDK README has a `## Skills` section that links the skills covering it, or says why none do.
- `scripts/reviewed-surface.json` records each of those workspaces' entrypoints and exported names, and the root package scripts, as of the last skill review. When the code changes that surface, the check names the skills to review. Update them in the same commit for what changed, then run `bun run skills:stamp <workspace>`. The stamp's diff shows reviewers what was reviewed.
- When a workspace gains an extension point that other code uses and no skill covers it, add a skill there.
- When two skills repeat the same steps, keep the steps in the skill of the package that owns them and link to it from the other.
- A skill links to docs and READMEs for detail instead of copying it. Paths it names must exist.

## Working practice

- Use `npx ctx7@latest library <name> '<question>'`, then `npx ctx7@latest docs <id> '<question>'` for current library APIs. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`.
- Prose follows `docs/styleguide.md` and uses the terms in `docs/glossary.md`.
- Do not discover or reuse provider credentials. Live probes need explicitly configured accounts. Never commit keys, data directories or generated launch credentials.
- Concurrent agents own disjoint files, announce interface changes and preserve each other's work. The root owns dependency manifests and the lockfile.
- This is a generic reference. Keep platform-specific cloud dependencies out of framework contracts and the runtime.
