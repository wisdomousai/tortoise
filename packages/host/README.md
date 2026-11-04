# @tortoise/host

The Bun host: the process that opens one application's instance. It owns workspace storage, launch and sessions, HTTP and SSE, embedded MCP, the CLI, agent runs and background delivery. It trusts the application definition, whose policy, handlers and connections run with the host's privileges, and trusts no caller.

- Primitives: [Application](../../docs/primitives.md#application), [Host](../../docs/primitives.md#host), [Feature](../../docs/primitives.md#feature), [Host plugin](../../docs/primitives.md#host-plugin), [Host platform](../../docs/primitives.md#host-platform), [Shell port](../../docs/primitives.md#shell-port), [State migration](../../docs/primitives.md#state-migration), [Shelf life](../../docs/primitives.md#shelf-life), [Remote query](../../docs/primitives.md#remote-query), [UI session context](../../docs/primitives.md#ui-session-context), [Agent run](../../docs/primitives.md#agent-run), [agent definition](../../docs/primitives.md#agent-definition), [Compliance bundle](../../docs/primitives.md#compliance-bundle).

## References

- [run-a-hosted-instance](skills/run-a-hosted-instance/SKILL.md), [write-a-feature](skills/write-a-feature/SKILL.md), [write-host-plugin](skills/write-host-plugin/SKILL.md)
- [Hosting](../../docs/hosting.md), [Host plugins](../../docs/architecture.md#host-plugins)
- Test: `bun test packages/host`, `bun run test:service`
