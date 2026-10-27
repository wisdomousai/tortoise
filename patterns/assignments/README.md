# @agent-native/pattern-assignments

`pattern-assignments` composes the base pattern unchanged with sampling rounds as [assignments](../../packages/assignments/README.md). A technician sends a round at a substation to a member or to a field service crew's application. Whoever takes the round reports the oil sample drawn from each transformer, and a technician accepts each report, which submits a test request for that sample.

## Layer

Content (`patterns/*`). It imports the base pattern, the framework and `@agent-native/peer-link`.

## Primitives

The pattern is one [application](../../docs/primitives.md#application) with the `assignment` [feature](../../docs/primitives.md#feature). Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `sampling` assignment kind, `defineAssignments`, the `sampling` module with `sampling.assignee.list`, and the [peer surface](../../docs/primitives.md#peer-link) that serves rounds to another application |
| `domain.ts` | Server | The state: the base `testRequests` slice, and the `assignment` slice the feature keeps |
| `policy.ts` | Server | `samplingAccess`, the feature's view of who may plan, read, work and review, and the route for `sampling` |
| `handlers.ts` | Server | The assignee list, and the kind's hooks: the scope check, the brief, the subject check and the accept hook |
| `application.ts` | Server | The base handlers in the `testRequests` slice, the feature mounted with its access and hooks, both routes, `selectableResources` and the peer link |
| `screens.tsx`, `ui/rounds.tsx` | Browser | The round board and reports, one round, one report, My rounds, and the peers screen |
| `ui/round-parts.tsx` | Browser | The transformer picker for the scope, the scope as the board shows it, placing a report on a transformer of its round, and accepting a sample with an optional test method |
| `ui/round.tsx` | Browser | The brief, the sample form and a sample as reported |

The kind declares:

- the scope: a substation and at most twenty transformers, each named once;
- the brief: the substation, and each transformer's most recent sample and test method in the lab when the round is sent;
- the report: a sample number and what to test and what was seen, about one transformer;
- the accept input: an optional test method;
- the lanes: person and peer. Drawing oil takes someone at the transformer, so the kind has no agent lane.

Accepting runs `test-request.submit` with the report's sample, its transformer and description, and the method when one is given, as the technician who accepts, through `ctx.invoke`, a [nested invocation](../../docs/primitives.md#nested-invocation). A transformer is a name in the scope, not a record, so a round can include one the lab has no test request for yet.

The screens are the registry's `assignment-board`, `assignment-reports` and `my-assignments`, with every slot filled:

- The planner enters the substation, ticks transformers from those in the lab's test requests or adds one by name, and the board shows each round's substation and transformers.
- The assignee reads the brief and reports a sample on one transformer at a time.
- A report names its transformer and reads as the sample number with its description. An unplaced report is placed on one of the transformers its round was sent with.
- The technician accepts a report with or without a test method.
- The assignee picker lists the members from `sampling.assignee.list`, and connected peers from `peer.list`, which only the workspace owner may read.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-assignments/manifest` | Browser and server | The test requests and sampling modules, the assignment feature and the peer link plugin manifest |
| `@agent-native/pattern-assignments/contracts` | Browser and server | The kind, the operations and the peer surface; `patterns/worklist` imports it |
| `@agent-native/pattern-assignments/application` | Server | `createTestRequestsAssignmentsApplication` |
| `@agent-native/pattern-assignments/screens` | Browser | The screens above |

## Trust boundary

`samplingAccess` repeats the base pattern's membership gate, because the feature never asks the application's policy:

- A non-member is refused everything, the feed included.
- Technicians plan, read and review.
- Every member takes rounds sent to them. A viewer sees them in the feed and cannot list the board.
- A run acting for a technician only reads.
- A peer application's service principal only works on what was sent to it.

The feature matches the assignee itself: the person with no grant, or the peer's service principal. A member's report on a transformer outside the round is refused. A peer reports from its copy of the brief, so its report on such a transformer is kept without a subject for a technician to place. Any report is refused once the round is closed or withdrawn.

Accepting is person-only. The accept hook refuses an unplaced report and a sample number that already has a test request, both with `CONFLICT`, and runs `test-request.submit` as the technician inside the accept command's transaction. A refused submit leaves the report new.

## Dependencies

`@agent-native/pattern-base`, `@agent-native/assignments`, `@agent-native/peer-link`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, `@agent-native/react`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test patterns/assignments/
```

- `test/rounds.test.ts`: covers the person lane:
  - A viewer may not plan, and a transformer listed twice is refused.
  - A round sent to Vera shows in her feed with each transformer's last sample, and a non-member is refused the feed.
  - A report on a transformer outside the round is refused, and a late report after Done is still taken.
  - A viewer may not accept. A technician's accept submits a test request with or without a method; an unplaced report and a sample number already in the lab are refused with `CONFLICT`.
  - After Close, reports are refused and the feed is empty.
  - The assignee list names the members.
- `test/ui-bindings.test.ts`: every bound capability, the feature's included, is referenced by a screen in this pattern, the base or the peer link plugin.
- `e2e/rounds.pw.ts`, in Chromium against the real host:
  - The owner enters a substation, picks two transformers through the search, adds a third by name and sends the round to the owner.
  - My rounds shows the brief, takes a sample on each transformer and Done.
  - On the board, one sample is accepted with a method and the other report is discarded.
  - A report recorded through the API without a transformer cannot be accepted until it is placed on one of the round's transformers.
  - The round is closed, and the test request list shows the accepted samples.

`patterns/worklist` tests the peer lane with this application as the issuer.

```sh
bunx playwright test patterns/assignments
```

Run the pattern in the browser:

```sh
cd patterns/assignments
bun run dev:web
```

Submit test requests, then on Sampling rounds create a round for yourself and report on it under My rounds. To use the peer lane, start `patterns/worklist` and connect it with a code from the Peers screen.

## Skills

- [assign-work](../../packages/assignments/skills/assign-work/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)
- [connect-two-applications](../../plugins/peer-link/skills/connect-two-applications/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Assignments](../../docs/assignments.md)
- [Base pattern](../base/README.md)
- [Worklist pattern](../worklist/README.md)
