# Count activity with a host plugin

This pattern contributes an `activity` host plugin to the hypothetical [base application](../base/README.md). The plugin reads committed journal events through its delegated grant and records its counts through `activity.pass.record`.

The stored cursor commits with the counts, preventing a completed pass from being counted again after restart. The plugin owns its state and screen contribution; it does not change the base module's records.

```sh
cd showcase/patterns/host-plugin
bun run dev:web
```

## What to try

Submit and update a request (port 4353), then open **Activity**.

Set `TORTOISE_ACTIVITY_MODULES` to narrow the counted modules; startup refuses a module the application does not compose.

Read the summary as a viewer: only the local user may, and the counts contain operation names, never sample descriptions or principals.

## References

[write-host-plugin](../../../packages/host/skills/write-host-plugin/SKILL.md)

[Webhook plugin](../../../plugins/webhook/README.md)

`bun test showcase/patterns/host-plugin`
