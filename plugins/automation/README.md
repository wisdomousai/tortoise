# @tortoise/automation

`@tortoise/automation` starts declared work in response to a committed event or schedule. Compose `createAutomationPlugin` with the module containing the trigger declarations and add its plugin screens where trigger grants are managed.

A trigger requires a person-issued grant before it runs. Each invocation acts under that delegated grant and current authorization. An agent definition narrows the operations further through `agentGrant`. Revoking the issuer's access can therefore prevent later trigger execution.

## References

[Agents: triggers and their grants](../../docs/agents.md#triggers-and-their-grants)

[add-capability](../../packages/runtime/skills/add-capability/SKILL.md)

`bun test plugins/automation`
