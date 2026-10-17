# Working on this starter

`docs/architecture.md` describes the layers and how a request flows; `docs/primitives.md` lists the building blocks and where they live. Read them before changing a boundary.

## Layers

Four layers: **framework** `packages/*`, **plugins** `plugins/*`, **starter** `apps/*` and **content** `examples/*`.

- The framework and the starter name no domain and import no plugin or example. The starter hosts the one application named in `app.config.json`.
- An example is an application with `manifest` (browser-safe), `application` (server) and `screens` (browser) entrypoints. Its domain code, fakes, screens and tests stay in the example; framework tests never import one.
- A cross-cutting concern (site policy, network, audit, compliance) is a host plugin in `plugins/<name>`, with `plugin-manifest`, `plugin` and `plugin-screens` entrypoints that the application lists. A plugin imports the framework and the plugins it requires, reaches the network, ingress, identity and audit log through kernel ports, and writes only through its own commands.
- Generic host or frame behavior goes in the framework, so a forked starter keeps receiving it.

## Invariants

These protect data and security; `bun run check` and the conformance suites test them.

- Contracts are browser-safe. Handlers, React components, scenarios and provider code live in separate entrypoints.
- Every business write goes through the application runtime, never from a transport or harness.
- Authorize the operation, object and fields inside the transaction. Filter rows before paging or counting. Recheck delegated grants and event access.
- Server code reaches the network and child processes only through the network port.
- MCP, API, schema and reference docs are generated from the catalog. Run `bun run generate` after changing contracts.

## Guidance

Design on engineering merits. The rest of this section is advice; depart from it when the code is better for it, and say why in the commit message.

- Look for an existing primitive before adding one.
- Move a domain concept into the framework when a second application needs it. Reusable UI ships as a shadcn registry built from stock primitives.
- Keep modules focused. `check:size` lists long files and functions as hints; split by responsibility, not by line count.
- An operation usually gets a behavioral scenario and a UI binding.
- Each workspace has a README saying what it is for, what it trusts, and how to run its tests. Comment the non-obvious: transaction and authorization ordering, trust boundaries, failure behavior.
- When a primitive's meaning or status changes, update its entry in `docs/primitives.md`. Record what was actually run in `docs/implementation-status.md`, keeping deterministic tests, device runs and live provider runs apart.

## Working practice

- Use `npx ctx7@latest library <name> '<question>'`, then `npx ctx7@latest docs <id> '<question>'` for current library APIs. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`.
- Do not discover or reuse provider credentials. Live probes need explicitly configured accounts. Never commit keys, data directories or generated launch credentials.
- Concurrent agents own disjoint files, announce interface changes and preserve each other's work. The root owns dependency manifests and the lockfile.
- This is a generic reference. Keep platform-specific cloud dependencies out of framework contracts and the runtime.
