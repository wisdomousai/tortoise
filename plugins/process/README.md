# @tortoise/process

`@tortoise/process` provides the host's child-process port through `openProcesses`. Process bindings come from deployment policy and identify the executable with its permitted launch configuration.

The policy refuses relative executable paths and undeclared process bindings. A required process without a binding is unavailable. Server components must start a process through this port so policy controls the child configuration.

## References

[write-hardware-driver](../connector-driver/skills/write-hardware-driver/SKILL.md)

[deploy-an-application](../deployment/skills/deploy-an-application/SKILL.md)

`bun test plugins/process packages/kernel/test/processes.test.ts`
