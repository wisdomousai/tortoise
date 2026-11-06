# Suggest a lab test method

This pattern adds a requesting agent to the hypothetical [base application](../base/README.md). A trigger runs a deterministic method suggester when a test request has no method. The suggester submits an approval request for `test-request.update` under its restricted grant.

Approving the request invokes the update under the approver's current policy. The agent has no direct grant to perform that update. The fixture tests the declared tool and approval boundaries without establishing model reasoning.

```sh
cd showcase/patterns/agents
bun run dev:web
```

## What to try

Turn on the trigger on **Automation** (port 4352), then submit a request with no method and a description like "Dissolved gas after a Buchholz gas alarm."

Approve or reject the suggestion as a technician; a viewer cannot.

Open a request and send a message in the **Assistant** panel. Without a model the panel runs the deterministic harness, which reads a JSON script such as `{"commands":[],"text":"Done."}`. Reload: the conversation is still there.

**Suggest a method (offline run)** on the request screen starts the run directly and gives it a UI session, so it can ask for a review or open a record it may read without changing the stored request.

## References

[Agents](../../../docs/agents.md)

[Local model pattern](../local-model/README.md)

`bun test showcase/patterns/agents`
