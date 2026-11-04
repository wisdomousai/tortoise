# @tortoise/process

Provides the process port. `openProcesses` starts declared child processes with exactly the executable, arguments, directory and environment the site policy binds. The executable comes only from the deployment policy, which refuses a relative executable or working directory, a binding for an undeclared process, and an unbound required process.

Primitives:

- [Process port](../../docs/primitives.md#process-port)
- [Requirement declaration](../../docs/primitives.md#requirement-declaration)
- [Deployment policy](../../docs/primitives.md#deployment-policy)
- [Egress guard](../../docs/primitives.md#egress-guard)
- [Audit log](../../docs/primitives.md#audit-log)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [write-hardware-driver](../connector-driver/skills/write-hardware-driver/SKILL.md)
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md)
- `bun test plugins/process packages/kernel/test/processes.test.ts`
