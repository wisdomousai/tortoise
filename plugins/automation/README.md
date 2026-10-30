# @agent-native/automation

Runs agents or jobs without a person at the screen, on a committed change or a schedule. Declare a trigger with `defineTrigger`, compose `createAutomationPlugin`, and list its screens from `@agent-native/automation/plugin-screens`. A trigger does nothing until a person issues a trigger grant. Each run then acts as that person under a delegated grant that lists the trigger's capabilities, and `agentGrant` narrows an agent's grant further.

Primitives:

- [Trigger](../../docs/primitives.md#trigger)
- [Trigger grant](../../docs/primitives.md#trigger-grant)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Agent run](../../docs/primitives.md#agent-run)

## References

- [Agents: triggers and their grants](../../docs/agents.md#triggers-and-their-grants)
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)
- `bun test plugins/automation`
