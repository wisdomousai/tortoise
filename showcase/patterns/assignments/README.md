# Send an oil-sampling round

This pattern mounts the assignment feature on the hypothetical [base application](../base/README.md). Its sampling-round declaration supplies the scope and report schema. An accepted sample report creates a test request in the accepting transaction.

A local report must identify a transformer in the round. A peer report with an unrecognized subject is retained for an authorized technician to link. The receiving worklist is implemented in the [worklist pattern](../worklist/README.md).

```sh
cd showcase/patterns/assignments
bun run dev:web
```

## What to try

On **Sampling rounds** (port 4362), create a round for yourself, pick up to twenty transformers and send it.

On **My rounds**, report a sample and mark the round done.

Back on the board, accept the report with an optional test method; the sample appears as a test request.

Connect the [worklist pattern](../worklist/README.md) on **Peers** to send a round to another application.

## References

[Assignments](../../../docs/assignments.md)

[Worklist pattern](../worklist/README.md)

`bun test showcase/patterns/assignments`, `bunx playwright test showcase/patterns/assignments`
