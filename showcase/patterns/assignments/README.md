# Send an oil-sampling round

Before the lab can test oil, someone draws the samples at the transformers. This pattern adds sampling rounds to the [base lab desk](../base/README.md): a technician plans a round at a substation and sends it as an assignment to a person or to a field crew's application, the assignee reports a sample per transformer, and a technician's acceptance creates the lab's test request in the same transaction. The feature refuses a local report for a transformer outside the round and stores a peer's unlinked, for a technician to link.

```sh
cd showcase/patterns/assignments
bun run dev:web
```

## What to try

- On **Sampling rounds** (port 4362), create a round for yourself, pick up to twenty transformers and send it.
- On **My rounds**, report a sample and mark the round done.
- Back on the board, accept the report with an optional test method; the sample appears as a test request.
- Connect the [worklist pattern](../worklist/README.md) on **Peers** to send a round to another application.

## References

- [Assignments](../../../docs/assignments.md)
- [Worklist pattern](../worklist/README.md)
- `bun test showcase/patterns/assignments`, `bunx playwright test showcase/patterns/assignments`
