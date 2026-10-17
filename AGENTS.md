# Working on this starter

Read `docs/architecture.md` (including its design rules) and `docs/primitives.md` before changing boundaries.

- Contracts are browser-safe. Keep executable server handlers, React components, scenarios and provider code in separate entrypoints.
- Every business write uses the application runtime. Never write feature state from a transport or harness.
- Authorize current operation, object and fields inside the transaction. Filter rows before pagination/counts. Recheck delegated grants and event access.
- Generated MCP, API, schema and documentation come from the composed catalog. Run `bun run generate` after changing contracts.
- Keep one responsibility per module. Split a factory into module-level functions that take explicit dependencies, keep existing files as entry modules over a same-named folder, and keep barrels re-export only. `bun run check:size` enforces the limits.
- Preserve literal capability types. Add a behavioral scenario and a UI binding or explicit exception when adding an operation.
- Document public exports with purpose, trust boundaries, guarantees and failure behavior. Explain transaction/auth ordering in inline comments.
- Every workspace in `packages/*`, `plugins/*`, `apps/*` and `examples/*` has a `README.md` with the sections Primitives, Entrypoints, Trust boundary, Dependencies and Tests. It links to the primitive entries and explains what the code does not show on its own; it does not copy guarantees from `docs/primitives.md`. Update it in the same change as the code. `bun run check:readmes` fails on a missing README, an undocumented export, an unlinked primitive entry or a dead link.
- Use `npx ctx7@latest library <name> '<specific question>'`, then `npx ctx7@latest docs <resolved-id> '<question>'` for current library APIs. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`. Distinguish deterministic tests, native platform smoke tests and live provider evidence.
- Do not discover or reuse provider credentials. Live probes require explicit configured accounts. Never commit keys, data directories or generated local launch credentials.
- Concurrent agents must own disjoint files, communicate interface changes and preserve other work. Root owns dependency manifests and the lockfile.

This repository is a generic architecture reference. Avoid platform-specific cloud dependencies in framework contracts or runtime.

Four layers: **framework** `packages/*` (including `@agent-native/host` and `@agent-native/frame`), **plugins** `plugins/*`, **starter** `apps/*` and **content** `examples/*`. Content implements framework contracts; the starter wires one application, named in `app.config.json`, into the host and frame and imports no content statically. Neither the framework nor the starter names a domain. Each example is an application with `manifest` (browser-safe), `application` (server definition) and `screens` (browser) entrypoints. Put domain code, demo fakes, screens and their tests (`examples/<name>/test`, `examples/<name>/e2e`) in the example; framework tests never import an example. Generic host or frame behavior goes in the framework package, not the starter, so a forked starter keeps receiving it. A cross-cutting concern (site policy, network, audit, compliance, a notifier) is a host plugin, not host code: `plugin-manifest` (browser-safe, `definePluginManifest`), `plugin` (server, `defineHostPlugin`) and `plugin-screens` (browser, `definePluginScreens`), listed by the application in each of its three entrypoints. Every plugin lives in `plugins/<name>`; browser code is `plugin-manifest`, `plugin-screens`, `contracts`, `ui/` and `components/` (at the root or under `src/`), everything else is server code. A plugin imports the framework and the plugins it `requires`, never the starter or an example; its tests use fixture applications. The framework and the starter never import a plugin. It reaches the network, ingress, identity and audit log only through kernel ports, and writes only through its own commands.

## Design and primitives

Design on engineering merits: ports and adapters, dependency direction, safe defaults. The checks in `bun run check` are the rules, and `docs/architecture.md#design-rules` says what each protects. When a rule or check gets in the way of a better design, change the check and the rule's line in the same change. Put the reasoning where it is read: a check's failure message, the README's trust-boundary section, the topic guide, or the commit message.

`docs/primitives.md` documents each building block as a concept: its guarantees, gaps, status and code locations.

- Before designing, find the primitives that already exist. Extend or extract before adding something new.
- When you add, rename, move or remove a public export, package, registry item or enforcing script, update its primitive entry. Do the same when its guarantees or gaps change.
- Keep `packages/*` and `apps/*` domain-neutral. Move a domain concept into the framework once a second example needs it. Reusable UI ships as a shadcn registry built from stock primitives.
- Change a primitive's status (`proposed`, `partial`, `implemented`) only with matching evidence in `docs/implementation-status.md`.
