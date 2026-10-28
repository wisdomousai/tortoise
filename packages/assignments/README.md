# @agent-native/assignments

This package hands work to an assignee and takes structured reports back for review. An application declares assignment kinds as schemas: what the requester fills in, what the assignee receives, what one report holds and what a reviewer adds on accepting it. The package generates the operations of a [feature](../../docs/glossary.md#feature) with ID `assignment`, and the assignee's side, the worklist, for an application that takes work from another.

## Layer

Framework (`packages/*`). The contracts are browser-safe. The package imports framework packages only, never a plugin, example or pattern. Its source is portable, because a worklist runs on a phone.

## Primitives

- Assignment kind: `defineAssignmentKind`, `AssignmentKind`, `AssigneeType`. A kind lists the assignee types that may take it: `person`, `agent`, `device`, `peer` and `target`.
- Assignments: `defineAssignments` returns the feature manifest, the generated operations, one [target](../../docs/glossary.md#target) per assignment target (`assignment-<name>`) and what devices and peers may call (`assignees`).
- Worklist: `defineWorklist` returns the assignee's module, its operations and a [peer target](../../docs/glossary.md#peer-target) whose [feed](../../docs/glossary.md#feed) is the issuer's `assignment.feed`.
- `offerEventType(agentId)`: the [journal](../../docs/glossary.md#journal) event type of an assignment sent to an agent, which a trigger filters on. The agent definition lists `assignment.get`, the kind's report command and `assignment.complete`, with `resourceTypes: ['assignment']` and `creates: ['assignment-report']`, so a run scoped to the assignment can store its reports.
- Feature: `assignmentFeature(assignments, { targets })` from `./server` is the server part. Its slice keeps assignments, reports and each assignment target's watermark. The application mounts it with an `AssignmentAccess` view and, optionally, `AssignmentHooks`; `byKind` builds the hooks from one implementation per kind.
- Assignment target port: `assignmentTargetPort({ target, readBlob, work })` runs a function, such as a model call, once per offer and hands its reports to the target's sync.
- Worklist kit, from `./server`: `worklistHandlers(worklist, { slice, onReceived? })` over a `WorklistSlice` in the assignee application's state, `worklistRules(worklist)` for its `definePolicy`, and `connectWorklist(worklist, { application, workspaceId, principalId, client })` for its integration. The client is `network.client(target)` over hub-link and the peer link's service client over peer-link.

Each kind gets four commands: `assignment.<kind>.create`, `.send`, `.report` and `.accept`. Every kind shares these operations:

- `assignment.withdraw`, `assignment.complete` and `assignment.close`;
- the reads `assignment.list`, `assignment.get` and `assignment.feed`;
- `assignment.report.list`, `.get`, `.discard`, and `.link` when a kind's reports name a subject.

An assignment target adds `assignment.<name>.complete`, `.sync` and `.status`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/assignments` | browser and server | `defineAssignmentKind`, `defineAssignments`, `defineWorklist`, `offerEventType` and the schemas. |
| `@agent-native/assignments/server` | server | `assignmentFeature`, `byKind`, `assignmentTargetPort`, `isAssignee`, `canSee`, `canSeeReport`, `stageOf`, and the worklist kit: `worklistHandlers`, `worklistRules`, `connectWorklist` and `createWorklistSlice`. |
| `@agent-native/assignments/*` | browser and server | One source file from `src/`. |

## Trust boundary

The contracts are data. A kind is refused at definition time when:

- its ID or target name is invalid or one the generic operations use;
- it lists an unknown or repeated assignee type, or the `target` type without a target name;
- it sends brief blobs to a device or a peer, whose pull carries no blobs;
- its accept input has its own `id`.

`defineWorklist` refuses an issuer API that does not list every operation of the assignee type.

The feature's policy decides every assignment operation inside the transaction, from the application's `AssignmentAccess` and the feature's own state. The application's policy never sees these operations, so `allows` applies the application's membership gate itself.

- `plan` creates, sends and withdraws, and marks an assignment done for its assignee; `read` sees every assignment of a kind and its reports; `review` links, discards and accepts reports and closes assignments; `integrate` completes and syncs an assignment target, and only the principal configured for that target does.
- `work` lets a caller report on and complete only the assignments sent to it. The feature matches the assignee itself: a person is the principal with no grant and no peer; an agent is a run whose grant names that agent definition; a device is `device:<id>` with no peer; a peer is the peer application's service principal. A target is never a caller.
- Accepting a report is person-only. The accept hook writes the application's records in the same transaction, so its refusal writes nothing.
- An assignment or report the caller cannot see reads as `NOT_FOUND`, so a refusal does not confirm that it exists. A grant's resource scope applies to reads too.
- A report keeps the ID its reporter chose. The same report delivered again returns the stored one; a different body under that ID is a conflict. A done assignment still takes its assignee's reports, because a report can reach the issuer after the done mark when its delivery was retried; a withdrawn or closed one takes none.
- A report's subject must be a record the assignment covers, as the `subject` hook decides. A caller on this instance is refused one it does not cover. A device or a peer reports from its own copy of the brief, which may be out of date, so its report is stored without the subject for a reviewer to link. Linking refuses a subject the assignment does not cover.
- An assignment target's result applies only to the offer it names and only while the assignment is sent. The sync checks each report body against the kind and skips one it refuses, and drops a subject the assignment does not cover, so a reviewer links that report.
- Brief blobs are attached to `assignment:<id>`, so the target's port reads them through `readEffectBlob` and nothing else.
- The worklist records a report or a done mark locally and enqueues it in the same transaction. The issuer authorizes each delivery again as the assignee's principal there, so the worklist widens nothing at the issuer. The worklist applies the issuer's feed as its whole open set, and a refused done mark reopens the assignment. A change to one of the assignee operations at the issuer holds deliveries and pulls until the two applications agree.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/kernel` and `@agent-native/integration`. Libraries: `zod`, and `@noble/hashes` for the feed cursor.

## Tests

```sh
bun test packages/assignments
```

- `test/kind.test.ts`: kind defaults and every refusal.
- `test/operations.test.ts`: the generated operation IDs in a catalog, per-kind targets, blobs and invokes, the generic reads across two kinds, the assignee operations, and the worklist's operations and refusals.
- `test/conformance.test.ts`: the feature conformance suite: deny-all refuses every command, allow-all admits each operation, accepting is person-only, and events route to the feature's policy.
- `test/lifecycle.test.ts`: a person assignee from create to close on a fixture application; drafts; refusals by assignee type, scope and subject; an accept hook that refuses and writes nothing; repeated and conflicting reports; withdrawal; discard.
- `test/worklist.test.ts`: a tablet application with the worklist against the fixture served over HTTP as a paired device: the feed, a report with a photo and the done mark at the issuer, work the issuer withdrew refused there and reopened here, and a drifted report command held.
- `test/assignees.test.ts`: an assignment target through the feature's `connect`: the offer with its brief blob, the result applied for review, a refused offer, a result for a withdrawn assignment, and a withdrawn offer cancelled before delivery. An agent assignee through the deterministic harness: the offer's event type, a run of another agent refused, and the assigned agent's report carrying its run.

`bun run test:portable` runs the same tests without the web globals.

`showcase/patterns/worklist` runs a peer assignee between two hosts, with `showcase/patterns/assignments` as the issuer.

## Limits

- `assignmentTargetPort` keeps results in memory until the target's sync applies them. If the host stops in between, the offer stays completed without its result, and the planner withdraws the assignment and sends it again.
- A report the sync skips is not recorded anywhere; the assignment shows only the reports it applied.

## Skills

- [assign-work](skills/assign-work/SKILL.md): declare an assignment kind, mount the feature with its access view and hooks, pick the assignee types and serve a worklist.

## References

- [Assignments guide](../../docs/assignments.md)
- [Feature](../../docs/glossary.md#feature)
- [Peer target](../../docs/glossary.md#peer-target)
- [Target](../../docs/primitives.md#target)
- [Assignments pattern](../../showcase/patterns/assignments/README.md)
- [Worklist pattern](../../showcase/patterns/worklist/README.md)
