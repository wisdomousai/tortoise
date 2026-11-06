# @tortoise/execution-host

`@tortoise/execution-host` runs configured tools inside a Linux bubblewrap sandbox. `createExecutionHostPlugin` exposes execution under a task-specific grant. The sandbox mounts the paths permitted by that task and uses the configured network proxy for outbound access.

The trusted caller of `run` determines the task and its context. Tool execution does not inherit arbitrary workspace authority. The package's Linux fixture suite exercises bubblewrap behavior; a host platform without bubblewrap cannot run this sandbox.

## References

[run-agent-tools-in-a-sandbox](skills/run-agent-tools-in-a-sandbox/SKILL.md)

[Agents: harnesses](../../docs/agents.md#harnesses)

`bun run test:execution-host:linux`
