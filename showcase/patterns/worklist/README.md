# A field crew's sampling worklist

The oil lab in the [assignments pattern](../assignments/README.md) sends sampling rounds to the field crew that draws the samples; this pattern is the crew's own application. The crew reads each round's instructions in its worklist, reports samples and marks the round done. A report commits locally with an outbox effect, the peer link delivers it, and the lab decides as `peer:<id>` whether to accept it; the worklist keeps a refusal with its reason and never resends a rejected report.

```sh
cd showcase/patterns/assignments && bun run dev:web   # terminal 1
cd showcase/patterns/worklist && bun run dev:web      # terminal 2
```

## What to try

- On the lab's **Peers** screen, create an enrollment code; enter it for the `lab` target on the worklist's **Peers** screen (port 4363).
- Send a sampling round to the peer from the lab's round board, report samples from the worklist, and accept them in the lab.
- Report a transformer outside the round: the lab keeps it without a subject for a technician to link.
- Withdraw the round in the lab and watch the worklist refuse further reports.

## References

- [Assignments](../../../docs/assignments.md)
- [connect-two-applications](../../../plugins/peer-link/skills/connect-two-applications/SKILL.md)
- [Assignments pattern](../assignments/README.md)
- `bun test showcase/patterns/worklist`, `bunx playwright test showcase/patterns/worklist`
