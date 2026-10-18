# @agent-native/automation

A host plugin that runs work without a person at the screen: triggers that start an agent definition or a deterministic job on a committed change or on a schedule. A trigger does nothing until a person enables it by issuing a standing grant, and every run acts as that person, narrowed to the trigger's operations. `line-station` composes it to close proposals nobody accepted in time.

Layer: plugins (`plugins/*`). It has the three plugin entrypoints an application lists.

## Primitives

- [Trigger](../../docs/primitives.md#trigger): `defineTrigger`, `TriggerDefinition`, `TriggerSource`, the jobs a trigger runs (`Job`, `JobContext`, `TriggerEvent`) and the checks `resolveTriggers` applies when the plugin opens.
- [Standing grant](../../docs/primitives.md#standing-grant): `automation.grant.issue`, `renew` and `revoke`, the `standingGrantSchema` record, and `runContext`, which turns a grant into the context one run executes under.
- [Host plugin](../../docs/primitives.md#host-plugin): `createAutomationPlugin`, `automationPluginManifest`, `automationScreens`.
- [Agent run](../../docs/primitives.md#agent-run): runs go through a run supervisor of the plugin's own, with the job harness (`createJobHarness`), the local harness when `localModel` is set, and any `agentHarnesses`. An agent run uses the first available harness that meets the agent's model requirement and fails with `UNAVAILABLE` when none does. Its model sees only the operations agent triggers may call. The prompt starts with `agentInstructions` (the definition's instructions and, for a proposing agent, each command it may propose with its input schema), then the trigger's prompt and what started the run.

## Entrypoints

| Import                                     | Runs in            | Contents                                                                                                      |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `@agent-native/automation/plugin-manifest` | browser and server | `automationPluginManifest`: the `automation` module.                                                          |
| `@agent-native/automation/plugin`          | server only        | `createAutomationPlugin({ triggers, jobs, localModel, agentHarnesses, intervalMs, now, newId })`.             |
| `@agent-native/automation/plugin-screens`  | browser            | `automationScreens`: the `/automation` route with triggers, grants and failed runs.                           |
| `@agent-native/automation/*`               | see file           | `contracts` (browser-safe), `jobs`, `triggers`, `server` (state, handlers, policy), `run`, `loop`, `run-ids`. |

Each pass of the loop lists the triggers and, for each with an active grant, reads the journal after its cursor as the issuer narrowed to the operations the trigger reacts to, or checks whether a new schedule slot began. It runs once per matching event or slot and records progress before the next, so a failure is recorded and passed, never retried. A grant seen for the first time starts at the snapshot that listed it, and a schedule starts with the next slot. Events nothing matched are skipped in memory, so an idle loop writes nothing.

Run IDs name the grant and the event cursor or slot (`auto:<grant>:event:<cursor>`). A job's command keys come from the run, the operation, its input and how often the run made that call, so a run repeated after a crash replays what it already committed. An agent's keys are its model's tool-call IDs, which are not stable across a repeat; give event triggers to proposing agents, whose repeat adds a proposal at worst.

## Trust boundary

A run is a caller like any other. Its context is the grant's issuer with a delegation listing the trigger's operations (for an agent, narrowed again by `agentGrant`), expiring at the earlier of the grant's expiry and the run's wall-time budget. The application's policy authorizes every call as the issuer, so a role they lost since issuing is refused, and the refusal becomes an open failure. Only a person (no run, no grant) issues, renews or revokes a grant, and only their own; issuing replaces any other active grant for the trigger, so one event never starts two runs. `automation.progress.record` is allowed only for a context with the issuer's principal and a run ID under that grant, which only the in-process loop creates. The plugin reaches nothing outside the authority except the local model, which it calls only through the network port's `local-inference` destination; the site policy binds it to a loopback address, and the guard refuses any other.

Gaps: revoking a grant stops future runs; a run in progress finishes within its budget. Runs use the plugin's own supervisor, so they do not appear in the host's run panel. Triggers are declared in code, not created at run time. Model harnesses are not chosen by an agent's model requirement; the application passes one.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/agents`, `@agent-native/host/plugin`, `@agent-native/host/plugin-manifest`, `@agent-native/host/application` (types), `@agent-native/frame/plugin-screens`, and `@agent-native/testing` and `@agent-native/event-log` (tests). External: `zod`, `react`, `@tanstack/react-query`, `lucide-react`; the screen uses the starter's `@/components/ui` primitives and `@/lib/session`. It never imports `apps/*` or `examples/*`; its tests use a fixture lots application.

## Tests

```sh
bun test plugins/automation
```

- `test/automation.test.ts`: an event runs its job once as the issuer, and a crash after the commit but before the record replays on restart instead of repeating; the audit log records the run's command under the issuer and run and the recorded outcome; revoking stops future runs; a demoted issuer's run fails once into an open failure that only the issuer sees and resolves; only people issue, renew and revoke, each their own, and only the loop records progress; a schedule runs once per slot from the next one, within its budget; triggers that name unknown operations, jobs or agents, schedules under a minute, and runs that would start themselves are refused when the plugin opens.
- `test/host.test.ts`: a serving host runs an enabled trigger and resumes from recorded progress after a restart; the screen references every bound operation.
- `test/local-proposal.test.ts`: on a serving host with the site and network plugins, a received lot starts a run of a proposing agent on a local model, reached only through the `local-inference` destination bound to a loopback fixture server. The model sees only the lot query and `proposal.submit`; the proposal names the issuer, the run and the model and changes nothing; a viewer's accept is refused and leaves it open, and an inspector's accept commits the inspection as the inspector.
- `test/live.test.ts`: the same flow on a real model, run only when `LOCAL_MODEL_GGUF` names a GGUF file. The test starts llama.cpp `llama-server` itself and binds `local-inference` to it with a five-minute `timeoutMs`.

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.
