# Suggest a lab test method

A technician submits an oil-sample request without a test method. This pattern adds a method suggester to the [base lab desk](../base/README.md): the suggester submits an [approval request](../../../docs/primitives.md#approval-request) instead of changing the request itself.

## Try a suggestion

From the repository root:

```sh
cd showcase/patterns/agents
bun run dev:web
```

Enable the trigger on the Automation screen. Submit a request with no method and a description such as “Dissolved gas after a Buchholz gas alarm.” The matching suggestion appears on the request. A technician can approve or reject it; a viewer cannot. **Suggest a method (offline run)** starts the deterministic run directly from the request screen.

## How the request reaches a person

The trigger starts only after a person issues its grant. The job reads the new request, matches words such as gas, breakdown, furan or water in [`method.ts`](method.ts), and requests approval for `test-request.update`. If no word matches, the job proposes nothing. A technician's approval runs the update under that technician's policy; the suggester's grant never includes the update command.

The request screen also gives a run a UI session. The run can request a review or open a readable resource through checked UI intents. Those intents change the screen, not the stored request. [`automation.ts`](automation.ts) declares the trigger, and [`ui/methods.tsx`](ui/methods.tsx) connects the screen.

## Checks

```sh
bun test showcase/patterns/agents
```

The automation and agent-scenario tests use a deterministic harness and check approval, grant revocation and refused direct writes. No live model is needed for this pattern. For the model-backed version, see [local model](../local-model/README.md).
