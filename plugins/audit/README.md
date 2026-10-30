# @agent-native/audit

Keeps the host's hash-chained audit log, forwards it when the site policy names a collector, and records what runs before the first request. Compose `openAudit`. The `audit-log` setting (`--audit-log` or `AGENT_NATIVE_AUDIT_LOG`) is a trusted launcher input. In required mode, a command whose `command.accepted` append fails rolls back. `bun run cli audit verify --log <dir>` checks a log offline.

Primitives:

- [Audit log](../../docs/primitives.md#audit-log)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [Security and compliance: audit log](../../docs/security-and-compliance.md#audit-log)
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md)
- `bun run test:sandbox`
