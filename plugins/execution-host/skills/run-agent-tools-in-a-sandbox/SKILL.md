---
name: run-agent-tools-in-a-sandbox
description: Run the tools an agent uses (shell commands, a provider CLI, the application's CLI or MCP server) inside a Linux bubblewrap sandbox with a run-bound grant, through the execution host plugin. Use when an agent run or trigger job must execute code that is not trusted, when declaring a sandbox and its network destinations, when binding bubblewrap in a deployment policy, or when testing what a sandbox can reach. Covers plugins/execution-host and its use of plugins/process and plugins/network.
---

# Run agent tools in a sandbox

The [execution host](../../../../docs/glossary.md#execution-host) runs an agent's tools in a sandbox: a declared child process whose executable is bubblewrap. The task inside sees only the tools and paths it names. It reaches the host API with a token bound to its run's [grant](../../../../docs/glossary.md#grant), and the network only through the egress proxy. Before choosing what to mount, read the trust boundary in the [plugin README](../../README.md).

## Before writing

- List the tools by absolute path, such as `bun`, `git` or a provider CLI. Only these executables exist inside, at their host paths, plus the C library.
- Decide the paths. A working directory is bound read-write at `/work`, and anything else is read-only, such as a checkout to read. Nothing else of the host is visible.
- List the [destinations](../../../../docs/glossary.md#destination) the tools must reach, such as a model API. The manifest declares each one, and the [deployment policy](../../../../docs/glossary.md#deployment-policy) binds it.
- A sandbox without destinations has no network except the host API.
- Decide who the sandbox acts as. Its context must carry a delegated grant, normally from `agentGrant(catalog, agentId, issuer, { now, runId })` in `@agent-native/runtime`. The sandbox can then call only what the agent definition allows.

## Steps

1. Declare the sandbox in the manifest's `components` with `executionSandbox({ id, description, network: ['model-api'] })` from `@agent-native/execution-host/contracts`.
2. Declare each destination the sandbox names.
3. Add `executionHostPluginManifest` to the manifest's `plugins`, after the site, network and process plugins.
4. Add `createExecutionHostPlugin({ tools: { bun: '/usr/local/bin/bun' } })` to the definition's `plugins`, in the same order.
5. Bind bubblewrap in the deployment policy under `processes`, with its digest pinned: `"<id>": { "executable": "/usr/bin/bwrap", "sha256": "…" }`. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) covers the policy.
6. Run tasks from trusted host code with `services['execution-host'].run({ sandbox, command: ['bun', script, ...args], context, workdir, readOnly, limits })`. Inside, `AGENT_NATIVE_CONNECTION` points at the [connection file](../../../../docs/glossary.md#connection-file). The application CLI (`packages/adapters/src/cli.ts`) and MCP server (`packages/adapters/src/mcp.ts`) attach with it and need no arguments.
7. Read the task's effects from the command receipts and the host's state, never from the task's narration.
8. Stop a task by passing a `signal`, or use `start` for a handle with `cancel()` and `revoke()`.
9. Set `limits` for wall time and output that fit the task.

## Checks

1. On any platform, run `bun test plugins/execution-host`. It covers the filter, the layout and the broker.
2. Call `availability(sandbox)` to learn why a sandbox cannot run: not Linux, no bubblewrap binding, or no serving host.
3. On Linux, or anywhere with Docker, run `bun run test:execution-host:linux`. Add test paths to run an application's own sandbox tests in the same container.
4. For an application's own task, copy the pattern in `plugins/execution-host/test/sandbox.test.ts`. Start the host with the plugin and run the task.
5. Assert the receipts, the refused calls outside the grant, and the denied file and network attempts that matter to the task.

Record a run in a container separately from a run on a deployed host in [implementation status](../../../../docs/implementation-status.md#execution-host).

## References

- [Security and compliance](../../../../docs/security-and-compliance.md#agent-tool-sandboxes)
