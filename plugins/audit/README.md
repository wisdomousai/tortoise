# @tortoise/audit

`@tortoise/audit` opens the host's configured event log through `openAudit`. The trusted launcher supplies `audit-log` through the setting, CLI option or environment variable. A configured collector can receive forwarded events.

In required mode, failure to append `command.accepted` prevents the command transaction from committing. The later `command.committed` append records the committed outcome; its failure has separate recovery behavior. `bun run cli audit verify --log <dir>` verifies a stored log without starting the application.

## References

[Security and compliance: audit log](../../docs/security-and-compliance.md#audit-log)

[deploy-an-application](../deployment/skills/deploy-an-application/SKILL.md)

`bun run test:sandbox`
