# A field crew's sampling worklist

This hypothetical receiving application declares a worklist for sampling rounds issued by the [assignment pattern](../assignments/README.md). It commits a report locally with an effect addressed to the lab peer. The receiving lab authorizes the report and records whether it accepts it.

The worklist retains a rejected report and its reason without resending it. Report-subject mapping remains the issuer's decision. The peer enrollment below establishes the link between these local applications.

```sh
cd showcase/patterns/assignments && bun run dev:web   # terminal 1
cd showcase/patterns/worklist && bun run dev:web      # terminal 2
```

## What to try

On the lab's **Peers** screen, create an enrollment code; enter it for the `lab` target on the worklist's **Peers** screen (port 4363).

Send a sampling round to the peer from the lab's round board, report samples from the worklist, and accept them in the lab.

Report a transformer outside the round: the lab keeps it without a subject for a technician to link.

Withdraw the round in the lab and watch the worklist refuse further reports.

## References

[Assignments](../../../docs/assignments.md)

[connect-two-applications](../../../plugins/peer-link/skills/connect-two-applications/SKILL.md)

[Assignments pattern](../assignments/README.md)

`bun test showcase/patterns/worklist`, `bunx playwright test showcase/patterns/worklist`
