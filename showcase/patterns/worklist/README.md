# A field crew's sampling worklist

The oil lab in the [assignments pattern](../assignments/README.md) sends sampling rounds to a separate field-crew application. The crew reads each brief in its [worklist](../../../docs/primitives.md#worklist), reports samples and marks the round done. The lab decides whether to accept each report and the worklist shows the result.

## Connect the two applications

From the repository root, start each application in a separate terminal:

```sh
cd showcase/patterns/assignments
bun run dev:web
```

```sh
cd showcase/patterns/worklist
bun run dev:web
```

On the lab's **Peers** screen, create an enrollment code. Enter that code for the `lab` target on the worklist's **Peers** screen, then send a sampling round to the peer from the lab's round board. The crew can report samples from the worklist; a lab technician accepts them into test requests.

## How reports travel

The worklist pulls the lab's open assignment feed and keeps a local copy of each brief. A report or done mark commits locally with an outbox effect, then travels to the lab through the peer link. The lab sees the service principal `peer:<id>`, checks its own assignment state and returns acceptance or a refusal. The worklist keeps a refusal and its reason; it does not resend a rejected report.

If a transformer is outside the round, the lab keeps the peer report without a subject for a technician to link. If the lab withdraws or closes the round, later reports are refused and the next feed closes the worklist copy. The peer credential stays in the peer link and the call does not assert an individual crew member's identity.

## Code and checks

[`contracts.ts`](contracts.ts) declares the worklist and `lab` target; [`application.ts`](application.ts) connects the peer, and [`policy.ts`](policy.ts) separates local technicians from the integration principal.

```sh
bun test showcase/patterns/worklist
bunx playwright test showcase/patterns/worklist
```

The peer test and browser spec start both hosts on loopback and check reporting, completion and a withdrawn-round refusal.
