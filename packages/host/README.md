# @tortoise/host

`@tortoise/host` runs an application's instance on Bun. Its serving entrypoint opens the selected workspace and exposes the configured API. The CLI supports attached calls to that instance and embedded commands that open the workspace themselves.

The host supplies trusted execution context and manages agent runs. Background integrations deliver the application's outbox effects after local commits. Host plugins supply configured facilities through kernel ports. Application server code executes with host privileges, so the application definition is part of the host's trust boundary.

## References

[run-a-hosted-instance](skills/run-a-hosted-instance/SKILL.md), [write-a-feature](skills/write-a-feature/SKILL.md), [write-host-plugin](skills/write-host-plugin/SKILL.md)

[Hosting](../../docs/hosting.md), [Host plugins](../../docs/architecture.md#host-plugins)

Test: `bun test packages/host`, `bun run test:service`
