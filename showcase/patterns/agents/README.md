# Suggest a lab test method

A technician may submit an oil-sample request without a test method. This pattern adds a method suggester to the [base lab desk](../base/README.md): a trigger starts a deterministic job that matches words such as gas, breakdown, furan or water and submits an approval request for `test-request.update`. The suggester's grant never includes the update itself; a technician's approval runs it under that technician's role.

```sh
cd showcase/patterns/agents
bun run dev:web
```

## What to try

- Turn on the trigger on **Automation** (port 4352), then submit a request with no method and a description like "Dissolved gas after a Buchholz gas alarm."
- Approve or reject the suggestion as a technician; a viewer cannot.
- **Suggest a method (offline run)** on the request screen starts the run directly and gives it a UI session, so it can ask for a review or open a record it may read without changing the stored request.

## References

- [Agents](../../../docs/agents.md)
- [Local model pattern](../local-model/README.md)
- `bun test showcase/patterns/agents`
