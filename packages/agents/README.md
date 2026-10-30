# @agent-native/agents

Runs agents as ordinary callers. A harness (Codex, Claude, AI SDK, local, deterministic) gets the application's capabilities as tools under the starting person's narrowed grant. Tool implementations take identity and grant from the run, never from model arguments.

- Primitives: [Agent run](../../docs/primitives.md#agent-run), [agent definition](../../docs/primitives.md#agent-definition), [Model entry](../../docs/primitives.md#model-entry), [UI session context](../../docs/primitives.md#ui-session-context), [OS action](../../docs/primitives.md#os-action), [Credential vault](../../docs/primitives.md#credential-vault).

## References

- [serve-a-local-model](../../plugins/model-server/skills/serve-a-local-model/SKILL.md)
- [Agents](../../docs/agents.md), [Providers](../../docs/providers.md)
- Test: `bun run test:harness`
