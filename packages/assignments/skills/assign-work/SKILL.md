---
name: assign-work
description: Hand work to a person, an agent, a paired device, a peer application or a target as an assignment, and take structured reports back for a person to accept. Use when an application sends work out and reviews what comes back (a survey, a review, a reading, an inspection), when it adds an assignment kind or an assignee type, or when an application takes assignments from another one through a worklist.
---

# Assign work

An assignment sends a brief to an assignee, and the assignee sends reports back. The `assignment` feature generates the operations from assignment kinds; the application supplies the access view, the hooks and the screens. An application that takes work from another keeps a worklist.

## Before writing

- A change that a system of record decides is an outbox effect; follow the `connect-system-of-record` skill (`packages/integration/skills/connect-system-of-record/SKILL.md`).
- A command an agent asks a person to approve before it runs is an approval request; follow the `write-a-feature` skill (`packages/host/skills/write-a-feature/SKILL.md`) to mount `approvalFeature`.
- Decide per kind what the planner fills in, what the assignee needs to work offline, what one report holds and which record it is about, and what the reviewer may change on accepting.
- Decide the assignee types. A brief for a device or a peer includes no blobs.

## Steps

In an application made by `scaffold new`, `bun run scaffold add assignment-kind <id> --collection <type>` writes a kind for person assignees over that collection with its hooks, screens and a test, and the first kind adds the access view and the mount. That covers steps 1 to 5, the `mountFeature` call in step 6 and step 10; add the `selectableResources` entries of step 6 by hand. The generated kind reads the collection's generated `title` and `status` and names the `editor` role, so change it with the collection and roles.

1. Declare each kind with `defineAssignmentKind` from `@agent-native/assignments` in the browser-safe contracts: `id`, `title`, `description`, `scope`, `brief`, `report`, `accept`, `subject`, `blobs`, `assigneeTypes`, `target` for an assignment target, and the `invokes` and `changes` of the accept hook.
2. Call `defineAssignments({ kinds })` and export its `operations` flat from the contracts, so screens bind them by name.
3. List `assignments.manifest` in `defineManifest({ features })`.
4. Write the access view, `AssignmentAccess.allows(context, action, kind?)` for `plan`, `read`, `work`, `review` and `integrate`. Repeat the application policy's membership gate; the feature never asks the application's policy. Allow `integrate` only for the assignment target's integration principal.
5. Write the hooks with `byKind` from `@agent-native/assignments/server`: `scope` checks a new scope, `assignee` checks an assignee before sending, `brief` computes the brief, `subject` says whether the assignment covers a record, and `accept` writes the accepted report into the application's records through `ctx.invoke`. Add `newId` and `now` from the application's services for tests.
6. Mount it: `mountFeature(assignmentFeature(assignments), { access, hooks })` in `defineApplication({ features })`, and add `assignment` and `assignment-report` to `selectableResources` with `operations.get` and `operations.reportGet`.
7. For agent assignees, give the agent definition the assignment read, the kind's report command and `assignment.complete`, with `resourceTypes: ['assignment']` and `creates: ['assignment-report']`. Add an automation trigger on resource type `assignment`, the kind's create and send operations, and `offerEventType(agent.id)`.
8. For an assignment target, add a destination whose `targets` list `assignment-<target>`. Pass `targets: { <target>: { principalId, port } }` to `assignmentFeature`, where `port` returns `assignmentTargetPort({ target, readBlob, work })` from the connect context's `readBlob`.
9. For device assignees, pass `assignments.assignees.device.operations` to `createDeviceLinkPlugin({ syncOperations })`. For peer assignees, put `assignments.assignees.peer.commands` and `.queries` in the application's `definePeerApi`.
10. Bind the screens: the registry's `assignment-board`, `assignment-reports` and `my-assignments`. Fill their slots with a scope picker, a brief view, a report form, the subject's name, a linking input and the accept form, as `showcase/patterns/assignments/ui/rounds.tsx` and `showcase/examples/asset-survey/ui/assignments.tsx` do; without them the screens show JSON and take record keys. Follow the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`).
11. In the assignee's application, declare `defineWorklist({ namespace, target, assignments, issuer, assigneeType, destination })` from the issuer's contracts.
12. Keep a `createWorklistSlice()` in its state, add `worklistHandlers(worklist, { slice, newId, now })` (`onReceived` runs in the feed's transaction for each assignment received for the first time, for a notice), put `worklistRules(worklist)` in its `definePolicy` with the target's integration operations and event rules, and connect `connectWorklist(worklist, { application, workspaceId, principalId, client })`. The client is `network.client(target)` over hub-link and the peer link's service client over peer-link.
13. Bind the worklist screens: the registry's `worklist` on the web, or `worklist-list` and `worklist-sync` from `packages/frame-native` on a phone.
14. When the work lived in application state before, adopt it into the feature's slice with `mountFeature(..., { adopt })`, as the `write-a-feature` skill describes.

## Checks

```sh
bun test packages/assignments
bun run check:boundaries
bun run generate
```

Test the application through a fixture instance:

- the lifecycle from create through report, done, accept and close, as each role, with a refused role per action;
- a report on an uncovered subject, refused for a local caller and stored unlinked for a device or a peer;
- an accept hook that refuses and writes nothing;
- each assignee type the kind lists: a deterministic harness for an agent, `startPeerPair` for a peer, a paired device for a device, and a refused offer for an assignment target;
- the worklist's report, done mark, refusal and drift against the issuer.

Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`).

## References

- [Assignments](../../../../docs/assignments.md)
- [Assignments package](../../README.md)
- [Assignments pattern](../../../../showcase/patterns/assignments/README.md)
- [Worklist pattern](../../../../showcase/patterns/worklist/README.md)
- [Asset survey example](../../../../showcase/examples/asset-survey/README.md)
