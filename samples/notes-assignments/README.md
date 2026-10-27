# @agent-native/sample-notes-assignments

`sample-notes-assignments` composes the [notes sample](../notes/README.md) unchanged with note reviews as [assignments](../../packages/assignments/README.md). An editor sends a review of some notes to a member, to the `note.reviewer` agent or to a peer application. Whoever takes it reports a verdict per note, and an editor accepts each report into its note.

## Layer

Content (`samples/*`). It imports the base sample, the framework, `@agent-native/automation` and `@agent-native/peer-link`.

## Primitives

The sample is one [application](../../docs/primitives.md#application) with the `assignment` [feature](../../docs/primitives.md#feature). Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `review` assignment kind, `defineAssignments`, the `note.reviewer` [agent definition](../../docs/primitives.md#agent-definition), the `note-reviews` module with `review.assignee.list`, and the [peer surface](../../docs/primitives.md#peer-link) that serves reviews to another application |
| `domain.ts` | Server | The state: the base `notes` slice, and the `assignment` slice the feature keeps |
| `policy.ts` | Server | `reviewAccess`, the feature's view of who may plan, read, work and review, and the route for `note-reviews` |
| `handlers.ts` | Server | The assignee list, and the review kind's hooks: the scope check, the brief, the subject check and the accept hook |
| `reviewer.ts` | Server | `ruleReviewer`, a harness that plays the reviewer agent's calls by a fixed rule, so the sample needs no model |
| `automation.ts` | Server | The `review-sent-to-agent` [trigger](../../docs/primitives.md#trigger), which runs the reviewer on each review sent to it |
| `application.ts` | Server | The base handlers in the `notes` slice, the feature mounted with its access and hooks, both routes, `selectableResources`, automation and the peer link |
| `screens.tsx`, `ui/reviews.tsx` | Browser | The review board and reports, one review, one report, My reviews, and the automation and peers screens |
| `ui/review-parts.tsx` | Browser | The note picker for the scope, a note's title as a link, placing a report on a note of its review, and accepting a verdict with its comment |
| `ui/verdict.tsx` | Browser | The brief's notes, the verdict form and a verdict as reported |

The review kind declares the scope (note IDs), the brief (each note's title and text when the review is sent), the report (`keep` or `revise` and a comment, about one note) and the accept input (an optional comment that replaces the report's). Accepting runs `note.update` as the editor who accepts and appends `Review (<verdict>): <comment>` to the note's text.

The screens are the registry's `assignment-board`, `assignment-reports` and `my-assignments`, with every slot filled. The planner ticks notes from a searchable list, and the board names each review's notes. The assignee reads the brief's notes and reports a verdict on one note at a time. A report names its note and reads as keep or revise with its comment. An unplaced report is placed on one of the notes its review was sent with. The reviewer accepts the reporter's comment or edits it first. The assignee picker lists the members and the agent from `review.assignee.list`, and connected peers from `peer.list`, which only the workspace owner may read.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-notes-assignments/manifest` | Browser and server | The notes and note-reviews modules, the assignment feature, and the automation and peer link plugin manifests |
| `@agent-native/sample-notes-assignments/contracts` | Browser and server | The kind, the operations, the agent and the peer surface; `samples/notes-worklist` imports it |
| `@agent-native/sample-notes-assignments/application` | Server | `createNotesAssignmentsApplication` |
| `@agent-native/sample-notes-assignments/screens` | Browser | The screens above |

## Trust boundary

`reviewAccess` repeats the base sample's membership gate, because the feature never asks the application's policy:

- A non-member is refused everything, and the feed is refused too.
- Editors plan, read and review.
- Every member takes reviews sent to them. A viewer sees them in the feed and cannot list the board.
- A run acting for a member works, and reads only for an editor: the trigger loop reads the journal that way.
- A peer application's service principal only works on what was sent to it.

The feature matches the assignee itself: the person with no grant, a run of `note.reviewer`, or the peer's service principal. A member's or run's report on a note outside the review is refused. A peer reports from its copy of the brief, so its report on such a note is kept without a note for an editor to place. Any report is refused once the review is closed or withdrawn.

Accepting is person-only, so the reviewer's run cannot accept its own work. The accept hook runs `note.update` as the editor inside the accept command's transaction; a refused update leaves the report new.

The trigger's runs act as the person who enabled it, narrowed to the agent's three operations and to the assignment the run was started on. The rule reviewer goes through the same run tools a model's harness would.

## Dependencies

`@agent-native/sample-notes`, `@agent-native/assignments`, `@agent-native/automation`, `@agent-native/peer-link`, `@agent-native/agents`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test samples/notes-assignments
```

- `test/reviews.test.ts`: a viewer may not plan, and the scope must name existing notes. A review sent to Vera shows in her feed with the notes as they were, and is refused to a non-member. A report about a note outside the review is refused, and a late report after Done is still taken. A viewer may not accept; an editor's accept appends the comment to the note. After Close, reports are refused and the feed is empty. The assignee list names the members and the agent.
- `test/agent.test.ts`: once the owner enables the trigger, a review sent to `note.reviewer` is reported on per note by an `auto:` run as the owner and marked done. A review sent to a person starts no run. A viewer's accept is refused, and the editor's writes the verdict into the note.
- `test/ui-bindings.test.ts`: every bound capability, the feature's included, is referenced by a screen in this sample, the base or the automation and peer link plugins.
- `e2e/reviews.pw.ts`, in Chromium against the real host: the owner picks two notes through the search and sends the review to the owner. My reviews shows the brief, takes a verdict on each note and Done. On the board, an edited comment is accepted into its note, the other verdict is discarded and the review is closed.

`samples/notes-worklist` tests the peer lane with this application as the issuer.

```sh
bunx playwright test samples/notes-assignments
```

Run the sample in the browser:

```sh
cd samples/notes-assignments
bun run dev:web
```

Add notes, then on Reviews create a review for yourself and report on it under My reviews. To use the agent, enable the trigger on the Automation screen and send a review to Note reviewer. To use the peer lane, start `samples/notes-worklist` and connect it with a code from the Peers screen.

## Skills

- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)
- [connect-two-applications](../../plugins/peer-link/skills/connect-two-applications/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Assignments package](../../packages/assignments/README.md)
- [Agents](../../docs/agents.md)
- [Notes worklist](../notes-worklist/README.md)
