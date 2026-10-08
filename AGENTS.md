# Working on this starter

Read `docs/principles.md`, `docs/primitives.md`, `IMPLEMENTATION_PLAN.md` and `docs/architecture.md` before changing boundaries.

- Contracts are browser-safe. Keep executable server handlers, React components, scenarios and provider code in separate entrypoints.
- Every business write uses the application runtime. Never write feature state from a transport or harness.
- Authorize current operation, object and fields inside the transaction. Filter rows before pagination/counts. Recheck delegated grants and event access.
- Generated MCP, API, schema and documentation come from the composed catalog. Run `bun run generate` after changing contracts.
- Keep one responsibility per module (P14). Split a factory into module-level functions that take explicit dependencies, keep existing files as entry modules over a same-named folder, and keep barrels re-export only. `bun run check:size` enforces the limits.
- Preserve literal capability types. Add a behavioral scenario and a UI binding or explicit exception when adding an operation.
- Document public exports with purpose, trust boundaries, guarantees and failure behavior. Explain transaction/auth ordering in inline comments.
- Every workspace in `packages/*`, `apps/*` and `examples/*` has a `README.md` with the sections Primitives, Entrypoints, Trust boundary, Dependencies and Tests. It links to the primitive entries and explains what the code does not show on its own; it does not copy guarantees from `docs/primitives.md`. Update it in the same change as the code. `bun run check:readmes` fails on a missing README, an undocumented export, an unlinked primitive entry or a dead link.
- Use `npx ctx7@latest library <name> '<specific question>'`, then `npx ctx7@latest docs <resolved-id> '<question>'` for current library APIs. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`. Distinguish deterministic tests, native platform smoke tests and live provider evidence.
- Do not discover or reuse provider credentials. Live probes require explicit configured accounts. Never commit keys, data directories or generated local launch credentials.
- Concurrent agents must own disjoint files, communicate interface changes and preserve other work. Root owns dependency manifests and the lockfile.

This repository is a generic architecture reference. Avoid platform-specific cloud dependencies in framework contracts or runtime.

Three layers (P11, ADR 005): **framework** `packages/*` (including `@agent-native/host` and `@agent-native/frame`), **starter** `apps/*` and **content** `examples/*`. Content implements framework contracts; the starter wires one application, named in `app.config.json`, into the host and frame and imports no content statically. Neither the framework nor the starter names a domain. Each example is an application with `manifest` (browser-safe), `application` (server definition) and `screens` (browser) entrypoints. Put domain code, demo fakes, screens and their tests (`examples/<name>/test`, `examples/<name>/e2e`) in the example; framework tests never import an example. Generic host or frame behavior goes in the framework package, not the starter, so a forked starter keeps receiving it.

## Principles and primitives

`docs/principles.md` states the architectural invariants (P1–P14), starting with: every operation is executable from UI, MCP, CLI and API. Each principle says what it rules out and which checks and tests enforce it, and marks what is still convention. `docs/primitives.md` documents each primitive as a concept: the core is a capability catalog over a logical CQRS authority where people, agents, scripts and devices are equal callers, extended by callers, integrations with other systems, and trust, configuration and proof. Each entry gives the guarantees, gaps, the principles it serves and its code. Both evolve with the code. Update them in the same change, not afterwards.

- Before designing, find the principles that apply and the primitives that already exist. Extend or extract before adding something new.
- When you add, rename, move or remove a public export, package, registry item or enforcing script, update its primitive entry. Do the same when its guarantees or gaps change. No tool checks these documents; reviewers check that the code change and the entry agree.
- Every primitive names the principles it serves. When you add a check or test that enforces a principle, list it under that principle's **Enforced by**; prefer turning convention into enforcement over adding prose. If no principle fits, add or amend a principle before writing code. Record a significant decision as an ADR in `docs/decisions/` that names the principle.
- A change that would break a principle stops for discussion. Do not work around it in code. Amending a principle is an explicit edit with a changelog line.
- Keep `packages/*` and `apps/*` domain-neutral. A domain concept becomes a primitive only when a second example needs it, and its gate must pass on more than one example. Reusable UI ships as a shadcn registry built from stock primitives.
- Change a primitive's status (`proposed`, `partial`, `implemented`) only with matching evidence in `docs/implementation-status.md`.
