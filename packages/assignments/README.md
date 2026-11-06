# @tortoise/assignments

`@tortoise/assignments` declares work that an application sends to an assignee. `defineAssignmentKind` supplies schemas for the assignment scope and its reports. `defineAssignments` produces the application feature declarations; server contributions are imported from `@tortoise/assignments/server`.

A receiving application declares its local worklist with `defineWorklist`. Composition refuses an issuer API that omits operations required by the selected assignee type. A submitted report remains subject to the issuer's acceptance operation and policy.

## References

[assign-work](skills/assign-work/SKILL.md)

[Assignments](../../docs/assignments.md)

[Assignments pattern](../../showcase/patterns/assignments/README.md), [Worklist pattern](../../showcase/patterns/worklist/README.md)
