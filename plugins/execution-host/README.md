# @tortoise/execution-host

Runs agent tools (shell commands, provider CLIs, scripts that call the app CLI) in Linux bubblewrap sandboxes. Compose `createExecutionHostPlugin`. A sandbox sees only the paths its task names and reaches the network only through the egress proxy. The host trusts the caller of `run`, which decides the task and its context, and trusts nothing the sandbox does.

Primitives:

- [Execution host](../../docs/primitives.md#execution-host)
- [Requirement declaration](../../docs/primitives.md#requirement-declaration)
- [Process port](../../docs/primitives.md#process-port)
- [Egress guard](../../docs/primitives.md#egress-guard)
- [Execution context](../../docs/primitives.md#execution-context)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Audit log](../../docs/primitives.md#audit-log)

## References

- [run-agent-tools-in-a-sandbox](skills/run-agent-tools-in-a-sandbox/SKILL.md)
- [Agents: harnesses](../../docs/agents.md#harnesses)
- `bun run test:execution-host:linux`
