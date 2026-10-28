# Count activity with a host plugin

The oil lab wants to know how many test requests were submitted or changed. This pattern adds an `activity` [host plugin](../../../docs/primitives.md#host-plugin) to the [base desk](../base/README.md). The plugin reads committed journal entries and shows counts by operation on its own screen.

## Try the counter

From the repository root:

```sh
cd showcase/patterns/host-plugin
bun run dev:web
```

Submit and update a request, then open **Activity**. The serving host runs the counting loop. By default the plugin counts every application module except its own; `AGENT_NATIVE_ACTIVITY_MODULES` narrows the set. Startup refuses a module name the application does not compose.

## How the plugin counts

The loop reads the journal under a delegated grant and records each pass with its own `activity.pass.record` command. The plugin stores a cursor with the counts, so replaying a pass after a crash does not count the same entries twice. Journal entries already removed by retention before the loop reads them cannot be counted.

The plugin's policy decides only its `activity.*` operations and slice. Summary readers start with the workspace owner; an ordinary lab viewer cannot read the counter. Counts contain operation names, not sample descriptions or principals.

The plugin lives in [`plugins/activity`](plugins/activity); [`counting.ts`](plugins/activity/counting.ts) reads the journal, and [`plugin.ts`](plugins/activity/plugin.ts) supplies the lifecycle hooks. Unlike the [webhook plugin](../../../plugins/webhook/README.md), this plugin needs no network destination.

## Checks

```sh
bun test showcase/patterns/host-plugin
```

The activity tests cover startup refusal, cursor recovery, duplicate passes and access to the summary. The [host-plugin guide](../../../packages/host/skills/write-host-plugin/SKILL.md) explains how to build a plugin for another application.
