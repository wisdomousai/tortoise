# @agent-native/automation

This [host plugin](../../docs/glossary.md#host-plugin) runs work without a [person](../../docs/glossary.md#person) at the [screen](../../docs/glossary.md#screen). A [trigger](../../docs/glossary.md#trigger) starts an [agent definition](../../docs/glossary.md#agent-definition) or a deterministic job on a committed change or on a schedule. A trigger does nothing until a person issues a [standing grant](../../docs/glossary.md#standing-grant) for it, and every run acts as that person, narrowed to the trigger's [capabilities](../../docs/glossary.md#capability).

## Layer

Plugin layer, with the three plugin entrypoints an application lists. It trusts the triggers and jobs the application passes in code. Every run is an ordinary [caller](../../docs/glossary.md#caller) that the application's [policy](../../docs/glossary.md#policy) authorizes.

## Primitives

- [Trigger](../../docs/primitives.md#trigger): `defineTrigger`, `TriggerDefinition`, `TriggerSource`, the jobs a trigger runs (`Job`, `JobContext`, `TriggerEvent`), and the checks `resolveTriggers` applies when the plugin opens.
- [Standing grant](../../docs/primitives.md#standing-grant): `automation.grant.issue`, `renew` and `revoke`, the `standingGrantSchema` record, and `runContext`, which turns a grant into the context one run executes under.
- [Host plugin](../../docs/primitives.md#host-plugin): `createAutomationPlugin`, `automationPluginManifest`, `automationScreens`.
- [Agent run](../../docs/primitives.md#agent-run): runs go through the plugin's own run supervisor. Its harnesses are the job harness (`createJobHarness`), the local harness when `localModel` is set, and any `agentHarnesses`.

[Agents](../../docs/agents.md#triggers-and-standing-grants) explains triggers and standing grants.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/automation/plugin-manifest` | browser and server | `automationPluginManifest`: the `automation` module. |
| `@agent-native/automation/plugin` | server only | `createAutomationPlugin`, with the options listed below. |
| `@agent-native/automation/plugin-screens` | browser | `automationScreens`: the `/automation` route with triggers, grants and failed runs. |
| `@agent-native/automation/*` | see file | `contracts` (browser-safe), `jobs`, `triggers`, `server`, `run`, `loop`, `run-ids`. |

`server` holds the state, handlers and policy. `createAutomationPlugin` takes `{ triggers, jobs, localModel, agentHarnesses, intervalMs, now, newId }`.

### Trigger loop

Each pass of the loop lists the triggers and visits each one with an active grant:

- an event trigger reads the journal after its cursor, as the issuer narrowed to the capabilities the trigger reacts to;
- a schedule trigger checks whether a new slot began.

The loop runs once per matching event or slot and records progress before the next. A grant seen for the first time starts at the snapshot that listed it, and a schedule starts with the next slot. Events that matched nothing are skipped in memory, so an idle loop writes nothing.

A run ID names the grant and the event cursor or slot, as in `auto:<grant>:event:<cursor>`. [Agents](../../docs/agents.md#triggers-and-standing-grants) explains failed runs, command keys and repeats after a crash.

### Agent runs

An agent run uses the first available harness that meets the agent's model requirement. When none does, the run fails with `UNAVAILABLE`. The plugin refuses to open when no harness it was given meets an agent trigger's model requirement. The model sees only the capabilities that agent triggers may call.

The prompt starts with `agentInstructions`: the definition's instructions and, for a proposing agent, each command it may propose with its input schema. The trigger's prompt and what started the run follow.

`line-station` composes the plugin to close proposals nobody accepted in time.

## Trust boundary

A run's context is the grant's issuer, under a [delegated grant](../../docs/glossary.md#grant) that lists the trigger's capabilities. For an agent, `agentGrant` narrows it again. The delegated grant expires at the earlier of the standing grant's expiry and the run's wall-time budget. The application's policy authorizes every call as the issuer, so a role the issuer lost since issuing is refused. The refusal becomes an open failure.

Only a person issues, renews or revokes a grant, and only their own; no run and no grant can. Issuing replaces any other active grant for the trigger, so one event never starts two runs.

`automation.progress.record` is allowed only for a context with the issuer's principal and a run ID under that grant. Only the in-process loop creates such a context.

The plugin reaches nothing outside the [authority](../../docs/glossary.md#authority) except the local model. It calls the model only through the network port's `local-inference` destination. The [deployment policy](../../docs/glossary.md#deployment-policy) binds that destination to a loopback address, and the guard refuses any other.

Limits:

- revoking a grant stops future runs, and a run in progress finishes within its budget;
- runs use the plugin's own supervisor, so they do not appear in the host's run panel;
- triggers are declared in code and cannot be created at run time;
- the application passes the harnesses agent triggers may use.

## Dependencies

- Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/agents`, `@agent-native/host/plugin`, `@agent-native/host/plugin-manifest`, `@agent-native/host/application` (types) and `@agent-native/frame/plugin-screens`.
- Tests only: `@agent-native/testing` and `@agent-native/event-log`.
- External: `zod`, `react`, `@tanstack/react-query` and `lucide-react`.

The screen uses the starter's `@/components/ui` primitives and `@/lib/session`. The plugin never imports `apps/*` or `examples/*`, and its tests use a fixture lots application.

## Tests

```sh
bun test plugins/automation
```

- `test/automation.test.ts` covers:
  - an event running its job once as the issuer, and a crash after the commit but before the record replaying on restart instead of repeating;
  - the audit log recording the run's command under the issuer and run, and the recorded outcome;
  - revoking stopping future runs;
  - a demoted issuer's run failing once into an open failure that only the issuer sees and resolves;
  - only people issuing, renewing and revoking, each their own, and only the loop recording progress;
  - a schedule running once per slot from the next one, within its budget;
  - refusal at open of unknown capabilities, jobs or agents, schedules under a minute, and runs that would start themselves;
  - an agent trigger skipping a remote harness for a local one, and failing with `UNAVAILABLE` when no harness qualifies.
- `test/host.test.ts`: a serving host runs an enabled trigger and resumes from recorded progress after a restart. The screen references every bound capability, and a local model is reached only through the network port.
- `test/local-proposal.test.ts`: on a serving host with the site and network plugins, a received lot starts a proposing agent's run on a local model. The model sees only the lot query and `proposal.submit`. The proposal names the issuer, the run and the model and changes nothing. A viewer's accept is refused and leaves it open, and an inspector's accept commits the inspection as the inspector.
- `test/live.test.ts`: the same flow on a real model, run only when `LOCAL_MODEL_GGUF` names a GGUF file. The test starts llama.cpp `llama-server` itself and binds `local-inference` to it with a five-minute `timeoutMs`.

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.
