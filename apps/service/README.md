# @tortoise/service

The instance process: HTTP server and CLI for the application named in `app.config.json`. Switching applications changes only that file. The host authenticates every caller; it prints a single-use, short-lived `launchUrl` and writes a connection file. `bun run dev:web` starts the server; `bun run cli help` lists the commands.

- Primitives: [Starter](../../docs/primitives.md#starter).

## References

- [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [Architecture](../../docs/architecture.md#instances-and-hosts)
- Test: `bun run test:service`, `bun run test:sandbox`
