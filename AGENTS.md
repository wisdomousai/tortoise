# Working on this starter

Read `IMPLEMENTATION_PLAN.md` and `docs/architecture.md` before changing boundaries.

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
