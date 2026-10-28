# Send an oil-sampling round

A lab technician plans a round at a substation and sends the [assignment](../../../docs/primitives.md#assignment) to a person or a field crew's application. The assignee reports a sample from each transformer. A technician accepts a report, creating the lab's test request in the same transaction.

## Try a round

From the repository root:

```sh
cd showcase/patterns/assignments
bun run dev:web
```

On **Sampling rounds**, create a round for yourself, choose or name transformers, and send it. Open **My rounds**, report a sample and mark the round done. Return to the board to accept the report with an optional test method; the accepted sample appears as a test request. To send work to another application, connect the [worklist pattern](../worklist/README.md) on the Peers screen.

## What the assignee receives

The round's scope contains one substation and up to twenty distinct transformers. When the technician sends the round, the brief includes each transformer's latest sample and test method known to the lab. Each report names a sample, what to test and the transformer; the technician may add a method on acceptance. The sampling kind accepts people and peers, because collecting the oil requires someone at the equipment.

Members may work only on rounds sent to them; technicians plan and review. A local person's report for a transformer outside the scope is refused. A peer's out-of-scope report is stored unlinked for a technician to link. Acceptance requires a person and refuses an unlinked report or duplicate sample. The accept hook invokes `test-request.submit` as the accepting technician, so a refused submission leaves the report unaccepted.

## Code and checks

[`contracts.ts`](contracts.ts) declares the kind and peer API, [`handlers.ts`](handlers.ts) builds briefs and accepts reports, and [`policy.ts`](policy.ts) supplies the feature's access view. The peer consumer lives in [worklist](../worklist/README.md).

```sh
bun test showcase/patterns/assignments
bunx playwright test showcase/patterns/assignments
```

The round tests cover person assignees, role refusals and acceptance; the browser spec exercises planning, reporting and review. The worklist tests cover the peer case.
