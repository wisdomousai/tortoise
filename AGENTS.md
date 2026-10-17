# Working on this starter

`docs/architecture.md` describes the layers and how a request flows; `docs/primitives.md` lists the building blocks and where they live. Read them before changing a boundary.

## Layers

Four layers: **framework** `packages/*`, **plugins** `plugins/*`, **starter** `apps/*` and **content** `examples/*`. Driver SDKs for other languages sit beside them in `sdks/*`.

- The framework and the starter name no domain and import no plugin or example. The starter hosts the one application named in `app.config.json`.
- An example is an application with `manifest` (browser-safe), `application` (server) and `screens` (browser) entrypoints. Its domain code, fakes, screens and tests stay in the example; framework tests never import one.
- A cross-cutting concern (site policy, network, audit, compliance) is a host plugin in `plugins/<name>`, with `plugin-manifest`, `plugin` and `plugin-screens` entrypoints that the application lists. A plugin imports the framework and the plugins it requires, reaches the network, ingress, identity and audit log through kernel ports, and writes only through its own commands.
- Generic host or frame behavior goes in the framework, so a forked starter keeps receiving it.
- A driver SDK in `sdks/<language>` implements the driver protocol that `plugins/connector-driver` defines, and proves itself against that plugin's reference contract. Nothing else imports an SDK, so the host depends on no driver language, and an SDK imports no application.

## Invariants

These protect data and security; `bun run check` and the conformance suites test them.

- Contracts are browser-safe. Handlers, React components, scenarios and provider code live in separate entrypoints.
- Every business write goes through the application runtime, never from a transport or harness.
- Authorize the operation, object and fields inside the transaction. Filter rows before paging or counting. Recheck delegated grants and event access.
- Server code reaches the network only through the network port, and starts child processes only through the process port.
- MCP, API, schema and reference docs are generated from the catalog when they are served or built. Nothing generated is committed; `bun run generate` writes the reference to `dist/reference/` for reading.

## Guidance

Design on engineering merits. The rest of this section is advice; depart from it when the code is better for it, and say why in the commit message.

- Look for an existing primitive before adding one.
- Move a domain concept into the framework when a second application needs it. Reusable UI ships as a shadcn registry built from stock primitives.
- Keep modules focused. `check:size` lists long files and functions as hints; split by responsibility, not by line count.
- An operation usually gets a behavioral scenario and a UI binding.
- Each workspace has a README saying what it is for, what it trusts, and how to run its tests. Comment the non-obvious: transaction and authorization ordering, trust boundaries, failure behavior.
- When a primitive's meaning or status changes, update its entry in `docs/primitives.md`. `docs/implementation-status.md` records only what `bun run check` cannot show (browser, device, live and by-hand runs) and the known gaps; don't restate what tests prove.

## Skills

Skills are task guides for coding agents. A repo-wide skill lives in `skills/<name>/`; a workspace keeps the skills for its own extension points in `<workspace>/skills/<name>/`. Run `bun run skills:link` once per checkout so Claude Code (`.claude/skills/`) and Codex (`.agents/skills/`) discover them; the links are not committed.

| Task | Skill |
| --- | --- |
| Start an application, export an example, pick the next skill | `skills/create-agent-native-app/SKILL.md` |
| Add or change a command or query, a record shape or a trigger | `skills/add-capability/SKILL.md` |
| Write a host plugin for a cross-cutting concern | `skills/write-host-plugin/SKILL.md` |
| Choose the checks and report the evidence | `skills/check-a-change/SKILL.md` |
| Connect a system of record: outbox, settle, sync, live reads | `packages/integration/skills/connect-system-of-record/SKILL.md` |
| Build screens and registry components | `packages/frame/skills/build-screens/SKILL.md` |
| Bridge station software through its screen | `packages/station/skills/bridge-station-screen/SKILL.md` |
| Add scanner and point-of-work input | `packages/devices/skills/add-scanner-input/SKILL.md` |
| Add OS handlers, actions and native registrations | `packages/shell/skills/add-os-integration/SKILL.md` |
| Extend the mobile host: native plugins, pairing | `packages/mobile/skills/extend-mobile-host/SKILL.md` |
| Write a hardware driver | `plugins/connector-driver/skills/write-hardware-driver/SKILL.md` |
| Deploy to a site: policy, signed bundles, install | `plugins/site/skills/deploy-to-site/SKILL.md` |

How skills grow with the code (`bun run check:skills` enforces the first and last points):

- A skill is named for a task, not a package, and names are unique across the repo. The owning workspace's README links it, and this table lists it.
- A change that adds or changes an extension point, a command or a check updates that workspace's skill in the same commit.
- When a workspace gains an extension point that other code uses and no skill covers it, add a skill there.
- When two skills repeat the same steps, move those steps into a repo-wide skill and link to it.
- A skill links to docs and READMEs for detail instead of copying it. Paths it names must exist.

## Working practice

- Use `npx ctx7@latest library <name> '<question>'`, then `npx ctx7@latest docs <id> '<question>'` for current library APIs. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`.
- Do not discover or reuse provider credentials. Live probes need explicitly configured accounts. Never commit keys, data directories or generated launch credentials.
- Concurrent agents own disjoint files, announce interface changes and preserve each other's work. The root owns dependency manifests and the lockfile.
- This is a generic reference. Keep platform-specific cloud dependencies out of framework contracts and the runtime.
