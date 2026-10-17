---
name: run-agent-tools-in-a-sandbox
description: Run the tools an agent uses (shell commands, a provider CLI, the application's CLI or MCP server) inside a Linux bubblewrap sandbox with a run-bound grant, through the execution host plugin. Use when an agent run or trigger job must execute code that is not trusted, when declaring a sandbox and its network destinations, when binding bubblewrap in a site policy, or when testing what a sandbox can reach. Covers plugins/execution-host and its use of plugins/process and plugins/network.
---

# Run agent tools in a sandbox

A sandbox is a declared child process whose executable is bubblewrap. The task inside sees only the tools and paths it names, reaches the host API with a token bound to its run's grant, and reaches the network only through the egress proxy. The [plugin README](../../README.md) describes the layout, the seccomp filter and the gaps; read its trust boundary section before choosing what to mount.

## Before writing

- List the tools by absolute path (`bun`, `git`, a provider CLI). Only these executables exist inside, at their host paths, plus the C library.
- Decide the paths: a working directory bound read-write at `/work`, and anything else read-only (a checkout to read). Nothing else of the host is visible.
- List the destinations the tools must reach, such as a model API. Each must be declared in the manifest and bound in the site policy; a sandbox without destinations has no network but the host API.
- Decide who the sandbox acts as. Its context must carry a delegation grant, normally from `agentGrant(catalog, agentId, issuer, { now, runId })` in `@agent-native/runtime`, so the sandbox can call only what the agent definition allows.

## Steps

1. **Declare the sandbox** in the manifest's `components`: `executionSandbox({ id, description, network: ['model-api'] })` from `@agent-native/execution-host/contracts`, and declare each destination it names.
2. **Compose the plugin** after the site, network and process plugins: `executionHostPluginManifest` in the manifest's `plugins`, and `createExecutionHostPlugin({ tools: { bun: '/usr/local/bin/bun' } })` in the definition's `plugins`.
3. **Bind bubblewrap** in the site policy under `processes`, with its digest pinned (`"<id>": { "executable": "/usr/bin/bwrap", "sha256": "…" }`), as in the `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`).
4. **Run tasks** from trusted host code: `services['execution-host'].run({ sandbox, command: ['bun', script, ...args], context, workdir, readOnly, limits })`. Inside, `AGENT_NATIVE_CONNECTION` points at the connection file, so the application CLI (`packages/adapters/src/cli.ts`) and MCP server (`packages/adapters/src/mcp.ts`) attach without arguments. Read effects from the command receipts and the host's state, never from the task's narration.
5. **Stop and revoke**: pass a `signal`, or use `start` for a handle with `cancel()` and `revoke()`. Set `limits` for wall time and output that fit the task.

## Checks

- On any platform: `bun test plugins/execution-host` covers the filter, layout and broker; `availability(sandbox)` explains why a sandbox cannot run (not Linux, no bubblewrap binding, no serving host).
- On Linux, or anywhere with Docker: `bun run test:execution-host:linux`. Copy the pattern in `plugins/execution-host/test/sandbox.test.ts` for an application's own task: start the host with the plugin, run the task, and assert the receipts, refused calls outside the grant, and the denied file and network attempts that matter to it.

```sh
bun test plugins/execution-host
bun run test:execution-host:linux
```

A run in a container is recorded separately from a run on a deployed host in [implementation status](../../../../docs/implementation-status.md#execution-host).
