# Working on this starter

Read `docs/principles.md`, `docs/primitives.md`, `IMPLEMENTATION_PLAN.md` and `docs/architecture.md` before changing boundaries.

- Contracts are browser-safe. Keep executable server handlers, React components, scenarios and provider code in separate entrypoints.
- Every business write uses the application runtime. Never write feature state from a transport or harness.
- Authorize current operation, object and fields inside the transaction. Filter rows before pagination/counts. Recheck delegated grants and event access.
- Generated MCP, API, schema and documentation come from the composed catalog. Run `bun run generate` after changing contracts.
- Preserve literal capability types. Add a behavioral scenario and a UI binding or explicit exception when adding an operation.
- Document public exports with purpose, trust boundaries, guarantees and failure behavior. Explain transaction/auth ordering in inline comments.
- Use `npx ctx7@latest library <name> '<specific question>'`, then `npx ctx7@latest docs <resolved-id> '<question>'` for current library APIs. Run network documentation requests outside the sandbox.
- Run the checks in `docs/development-and-testing.md`. Distinguish deterministic tests, native platform smoke tests and live provider evidence.
- Do not discover or reuse provider credentials. Live probes require explicit configured accounts. Never commit keys, data directories or generated local launch credentials.
- Concurrent agents must own disjoint files, communicate interface changes and preserve other work. Root owns dependency manifests and the lockfile.

This repository is a generic architecture reference. Avoid platform-specific cloud dependencies in framework contracts or runtime.

## Principles and primitives

`docs/principles.md` says why the framework is shaped as it is (P1–P15). `docs/primitives.md` lists the reusable building blocks that follow from those principles, and each one cites the principles it serves. Both evolve with the code. Update them in the same change, not afterwards.

- Before designing, find the principles that apply and the primitives that already exist. Extend or extract before adding something new.
- When you add, rename, move or remove a public export, package, registry item or enforcing script, update its catalog row. Do the same when its guarantees change. `bun run check:principles` (part of `bun run check`) fails on missing symbols, missing locations, unknown or retired principle IDs, uncataloged packages and principles with no implemented primitive.
- Every primitive cites at least one principle. If none fits, add or amend a principle before writing code. Record a significant decision as an ADR in `docs/decisions/` that names the principle.
- A change that would break a principle stops for discussion. Do not work around it in code. Amending a principle is an explicit edit with a changelog line. Principle IDs are permanent: retire one, never renumber.
- Keep `packages/*` domain-neutral. A domain concept becomes a primitive only when a second example needs it, and its gate must pass on more than one example. Reusable UI ships as a shadcn registry built from stock primitives.
- Change a primitive's status (`proposed`, `partial`, `implemented`) only with matching evidence in `docs/implementation-status.md`.
