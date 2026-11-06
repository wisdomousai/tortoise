# @tortoise/service

`@tortoise/service` launches the Bun host for the application selected in `app.config.json`. Its CLI attaches to the serving instance or opens a workspace in embedded mode for supported commands.

`bun run dev:web` starts the service with the web build. A local serving launch prints a single-use browser launch URL and writes the connection file used by attached callers. `bun run cli help` lists the operations and host commands available in that configuration.

## References

[create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md)

[Architecture](../../docs/architecture.md#instances-and-hosts)

Test: `bun run test:service`, `bun run test:sandbox`
