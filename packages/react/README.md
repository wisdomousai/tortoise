# @tortoise/react

`@tortoise/react` binds the client to React components. `useLiveQuery` subscribes a component to committed state through the client. `useCapabilityForm` validates form values with the capability schema and reuses an idempotency key when submission is retried.

UI-session helpers register the screen's selected resources and handle intents delivered to that session. An intent that prepares a form does not submit its command. The runtime authorizes the command when the person submits it.

## References

[build-screens](../frame/skills/build-screens/SKILL.md)

[Interaction contract](../../docs/interaction-contract.md), [Operations and state](../../docs/capability-authoring.md)
