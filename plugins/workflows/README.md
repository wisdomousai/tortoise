# @agent-native/workflows

This [host plugin](../../docs/glossary.md#host-plugin) runs the workflows an application's [modules](../../docs/glossary.md#module) declare with steps (`defineWorkflow` in [`packages/contracts`](../../packages/contracts/README.md)). `workflow.start` records an instance; the runner then advances it one step at a time, as the [person](../../docs/glossary.md#person) or run that started it, narrowed to the workflow's operations. A step runs a command or waits on a query. A step that fails is retried or, once it fails for good, the completed steps are undone in reverse order by their compensations.

## Layer

Plugin layer, with the three plugin entrypoints an application lists. It trusts the workflow declarations in the application's modules, which the catalog checked when it was built. Every step is an ordinary call that the application's [policy](../../docs/glossary.md#policy) authorizes as the starter.

## Primitives

- [Workflow](../../docs/primitives.md#workflow): the instances, runner and screen that run `defineWorkflow` declarations.
- [Host plugin](../../docs/primitives.md#host-plugin): `createWorkflowsPlugin`, `workflowsPluginManifest`, `workflowsScreens`.
- [Nested call](../../docs/primitives.md#nested-call): `workflow.advance` runs each step as a nested call (`invokes: 'any'`), so the step and the instance record commit together.

## Entrypoints

| Import                                    | Runs in            | Contents                                                                                             |
| ----------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `@agent-native/workflows/plugin-manifest` | browser and server | `workflowsPluginManifest`: the `workflow` module.                                                    |
| `@agent-native/workflows/plugin`          | server only        | `createWorkflowsPlugin({ intervalMs, now, newId })`.                                                 |
| `@agent-native/workflows/plugin-screens`  | browser            | `workflowsScreens`: the `/workflows` route with instances, their history, cancel, retry and resolve. |
| `@agent-native/workflows/*`               | see file           | `contracts` (browser-safe), `bindings`, `definitions`, `state`, `steps`, `due`, `policy`, `server`, `runner`.         |

### Instances

An instance stores its input, a `seq` that grows with every advance, the index of its next step, and, by step, only the result and effect paths that later steps and compensations read. Its statuses:

| Status                                  | Meaning                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `running`                               | The next step runs when due: now, after a retry backoff, or once the effects it awaits completed.                                                                           |
| `waiting`                               | A wait step's condition did not hold; it is checked again when a watched resource type changes, at its recheck interval, and at its timeout.                                |
| `compensating`                          | Completed steps are being undone, latest first.                                                                                                                             |
| `succeeded`, `compensated`, `cancelled` | Finished.                                                                                                                                                                   |
| `failed`                                | A step failed for good and no completed step had a compensation; its starter may retry or resolve it.                                                                       |
| `stalled`                               | Waits for a person: the definition changed (`DEFINITION_CHANGED`), the instance grant expired (`GRANT_EXPIRED`), or a compensation failed for good (`COMPENSATION_FAILED`). |

A step with `await: 'effects'` completes once every outbox effect its command enqueued was accepted. A rejected or cancelled effect fails the step with the target's code, and a held effect shows the instance as `held` until a person completes or releases it.

`UNAVAILABLE` and `CONFLICT` are retried, and so are the codes a step's `retry.on` lists, up to `retry.attempts` with a doubling backoff from `retry.backoffMs`. A step without a policy, and every compensation, gets three attempts one second apart. Any other code, `TIMEOUT` from a wait and `DEADLINE` past the maximum duration fail for good.

### Runner

A serving host starts the runner; an embedded host never advances an instance. Each pass:

1. reads `workflow.due` as the local owner;
2. for an instance that is due, runs `workflow.advance { id, seq }` as its starter with the run ID `wf:<id>` and the idempotency key `wf:<id>:<seq>`;
3. for a waiting instance that watches resource types, reads the journal after its last cursor and advances it only when a resource of a watched type changed;
4. when an advance fails, records the failure with `workflow.fail` under the key `wf:<id>:<seq>:fail`.

An advance that a crash interrupted after its commit replays its receipt on the same key, and an advance at a stale `seq` changes nothing, so no step runs twice. A pass with nothing due writes nothing.

## Trust boundary

`workflow.start` gives the instance a grant narrowed from the caller's: the workflow's operations, what they invoke, and `workflow.advance` and `workflow.fail`, with the caller's resource scope. It expires at the earlier of the caller's grant expiry and a day past the instance's deadline. A caller whose grant does not cover a step is refused at start. Each step passes the application's policy as the starter at that moment, so a role the starter lost since starting is refused, and the instance compensates.

- `workflow.start` is refused inside a `wf:` run, and the catalog refuses a step that reaches a `workflow.*` operation, so an instance never starts another.
- `workflow.advance` and `workflow.fail` are allowed only for the starter under the instance's run ID, a context only the in-process runner creates. `workflow.due` is for a workspace owner.
- `workflow.retry` and `workflow.resolve` are for the starter as a person; no run or agent acting as them can. Retrying renews the grant until a day past the later of now and the deadline.
- `workflow.cancel` is for the starter or a workspace owner.
- Reads show the starter everything and an owner status only. Journal entries for an instance are visible to the same people.

To learn when a watched type changed, the runner reads the journal as the starter without the instance grant, because the change that ends a wait comes from operations outside it. It uses only the resource types of what it reads there; the wait's query still runs under the grant.

Limits:

- steps run in order, one per advance; there are no branches or parallel steps, and `when` only skips a step;
- the runner runs only in a serving host, and a workflow makes no progress while the host is stopped;
- a step's command commits whole or not at all, with no savepoint inside it;
- an instance keeps the definition fingerprint it started with; a changed definition stalls it instead of migrating it.

## Dependencies

- Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host/plugin`, `@agent-native/host/plugin-manifest` and `@agent-native/frame/plugin-screens`.
- Tests only: `@agent-native/testing` and `@agent-native/event-log`.
- External: `zod`, `react`, `@tanstack/react-query` and `lucide-react`.

The screen uses the starter's `@/components/ui` primitives and `@/lib/session`. The plugin never imports `apps/*` or `examples/*`, and its tests use a fixture parcels application.

## Tests

```sh
bun test plugins/workflows
```

- `test/workflows.test.ts` covers:
  - a parcel reserved, shipped through an awaited effect, waited on until delivered, and confirmed with the carrier's reference, keeping only the paths later steps read;
  - a rejected effect, a wait timeout and a permanent failure each undoing the reservation;
  - a transient failure retried after its backoff;
  - the audit log recording each step as the starter within the instance run, nested under the advance;
  - a repeated advance replaying its receipt, and a stale `seq` changing nothing;
  - a held effect keeping the step waiting;
  - a changed definition stalling the instance, refusing a retry, and cancelling undoing it;
  - a role the starter lost refusing the step;
  - cancelling during a wait;
  - read scoping for the starter, the owner and anyone else;
  - refusals of the runner-only operations, of retry and resolve for a run, and of a start from a workflow run;
  - the instance grant ending with the starter's, refusing a grant that does not cover a step, and a retry renewing it;
  - one running instance per business key.
- `test/host.test.ts`: a serving host advances an instance through every step, across a restart. The screen references every bound capability.

## Skills

- [declare-a-workflow](skills/declare-a-workflow/SKILL.md): declaring a workflow, its start command and compensations, and testing it with the runner.
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md): the commands and queries its steps call.

## References

- [Capability authoring](../../docs/capability-authoring.md#declared-workflows)
- [Authorization](../../docs/authorization.md)
