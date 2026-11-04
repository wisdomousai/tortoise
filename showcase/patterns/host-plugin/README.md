# Count activity with a host plugin

The oil lab wants to know how many test requests technicians submitted or changed. This pattern adds an `activity` host plugin to the [base lab desk](../base/README.md): it reads the committed journal under a delegated grant, records each pass with its own `activity.pass.record` command, and shows counts by operation on its own screen, without touching the lab's module. A cursor stored with the counts keeps a pass replayed after a crash from counting twice.

```sh
cd showcase/patterns/host-plugin
bun run dev:web
```

## What to try

- Submit and update a request (port 4353), then open **Activity**.
- Set `TORTOISE_ACTIVITY_MODULES` to narrow the counted modules; startup refuses a module the application does not compose.
- Read the summary as a viewer: only the local user may, and the counts contain operation names, never sample descriptions or principals.

## References

- [write-host-plugin](../../../packages/host/skills/write-host-plugin/SKILL.md)
- [Webhook plugin](../../../plugins/webhook/README.md)
- `bun test showcase/patterns/host-plugin`
