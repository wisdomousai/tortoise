# @agent-native/sample-lab-requests-agents

`sample-lab-requests-agents` composes the [lab requests sample](../lab-requests/README.md) unchanged with agents. When a test request is submitted without a method, an agent suggests the method from its description as an [approval request](../../docs/glossary.md#approval-request). A technician approves or rejects each one. A run started from the test request screen sends [UI intents](../../docs/glossary.md#ui-intent) back to that screen.

## Layer

Content (`samples/*`). It imports the base sample, the framework and `@agent-native/automation`.

## Primitives

The sample is one [application](../../docs/primitives.md#application). It claims:

- an [agent definition](../../docs/primitives.md#agent-definition), `test-request.method-suggester`, whose output is `request-approval`;
- [agent runs](../../docs/primitives.md#agent-run) on the deterministic harness, started from the test request screen;
- [approval requests](../../docs/primitives.md#approval-request) for `test-request.update`, held in their own `suggestions` slice;
- a [trigger](../../docs/primitives.md#trigger), `suggest-methods-for-new-requests`, on `test-request.submit`;
- the [standing grant](../../docs/primitives.md#standing-grant) a person issues before the trigger runs;
- the [UI session context](../../docs/primitives.md#ui-session-context) that the test request screen registers;
- [agent scenarios](../../docs/primitives.md#agent-scenario) that judge the agent by what it commits and requests.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `method-suggestions` module: the approval operations and the method suggester |
| `domain.ts`, `method.ts` | Server; `method.ts` also browser | The `suggestions` slice, and the keyword table that maps a description to a test method |
| `handlers.ts` | Server | `approvalHandlers` over the `suggestions` slice. Only `test-request.update` may be requested |
| `policy.ts` | Server | The route for the `method-suggestions` module. It selects the whole state, so its rules read the base sample's members |
| `automation.ts` | Server | The trigger and its `suggest-method` job |
| `application.ts` | Server | The base handlers in the `labRequests` slice, the approval handlers, both routes, `selectableResources` and the automation plugin |
| `screens.tsx`, `ui/methods.tsx` | Browser | The base test request screen with a method section, the approvals list, the automation screen and `resources` |

`methodFor` in `method.ts` matches words such as tensile, hardness, salt spray and moisture to an ASTM method. It returns an empty string when no word matches, so the job and the screen suggest nothing.

The trigger reacts to `test-request.submit`. Its job reads the request and, when the method is empty and the description names a test, requests approval for `test-request.update` with that method. It runs as the person who issued its standing grant, narrowed to `test-request.get` and `approval.request`, so it never changes a request. It is a deterministic job, so a dev launch needs no model.

The test request screen registers the open request as the UI session context, because `test-request` is a selectable resource. **Suggest a method (offline run)** starts a deterministic run that requests approval for the method and then calls `ui.request-review`. The screen shows the review above the pending suggestions. `screens.resources` maps `test-request` and `approval-request` to the screens a `ui.open` intent leads to.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-lab-requests-agents/manifest` | Browser and server | The lab requests module, the method-suggestions module and the automation plugin manifest |
| `@agent-native/sample-lab-requests-agents/application` | Server | `createLabRequestsAgentsApplication` |
| `@agent-native/sample-lab-requests-agents/screens` | Browser | The test request screens with method suggestions, approvals and automation |

## Trust boundary

Any member may request approval. Approving needs a person and runs `test-request.update` as the approver, so the base sample's policy refuses a viewer's approval and the request stays pending. Rejecting and expiring need a technician. The suggester's grant leaves out `test-request.update` itself, so a run that tries to change a request directly is refused.

A run reaches the screen only through the `ui.*` run tools, and only for the UI session it captured when it started. Each intent is checked under the run's own grant. A resource the run cannot read, or a kind that is not selectable, is refused and never reaches the screen. Intents change no records.

## Dependencies

`@agent-native/sample-lab-requests`, `@agent-native/automation`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/agents` and `@agent-native/testing`.

## Tests

```sh
bun test samples/lab-requests-agents/
```

- `test/automation.test.ts`: the trigger does nothing before a grant. After it, a request without a method gets an approval request from an `auto:` run. A request that has a method, or whose description names no test, gets none. A viewer may neither approve nor reject. A technician's approval sets the method, a technician's rejection leaves it empty, and after revoking no request is made.
- `test/agent-scenarios.test.ts`: `runAgentScenarios` with the deterministic harness. The suggester requests approval and commits nothing, and its direct `test-request.update` is refused.
- `test/ui-intents.test.ts`: a run started from a UI session requests approval, opens the test request and asks for a review naming the approval request. The screen's poll receives both intents. A missing request and an unselectable kind are refused.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample, the base or the automation plugin.

Run the sample in the browser:

```sh
cd samples/lab-requests-agents
bun run dev:web
```

Enable the trigger on the Automation screen, then submit a request without a method whose description names a test, such as "Tensile strength of a welded coupon". A suggestion appears on the request's screen. On such a request, **Suggest a method (offline run)** starts the run from the screen.

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Agents](../../docs/agents.md)
- [Automation plugin](../../plugins/automation/README.md)
