# Assignments

The assignment feature stores issued work and the structured reports returned by its assignee. An application declares assignment kinds and mounts the feature with its access view. Acceptance runs application code that incorporates a report into local records under the reviewer's authorization.

Sending an assignment fixes the instructions the assignee receives. Returning a report records a proposed result. The feature authorizes acceptance separately so a report does not change application records merely because it was delivered.

## Kind declarations

An assignment kind declares the scope the planner supplies and the instructions computed when it is sent. Its report schema defines one returned body and its blob limits. A declared subject identifies the resource a report concerns. The accept schema specifies any additional input the reviewer must supply.

The kind also declares permitted assignee types. A target assignee names its target. The kind's `invokes` and `changes` declarations identify the operations and resource types its accept hook uses.

`defineAssignments` derives the feature manifest and the kind-specific operations for creating, sending, reporting and accepting. Shared operations handle assignment lifecycle and report review. The feature also supplies reads and `assignment.inbound`.

The application mounts these operations with hooks that validate the scope and assignee. Sending computes instructions through a hook. A subject-coverage hook checks whether a report still refers to work included by the assignment. The acceptance hook applies the reviewed result to application records. `byKind` collects these implementations by kind.

The feature authorizes its own operations. Its access view must apply the application's membership restrictions and grant scope because the application's policy does not receive those operations directly.

## Lifecycle

Creation stores a draft, unless the caller requests creation and sending in the same command. Sending validates the assignee and freezes the computed instructions. The assignee then submits reports using reporter-chosen identifiers. Repeating the same report returns the stored result; reusing its identifier with a different body conflicts.

The assignee marks its work done. Reports can still arrive after that mark because an earlier delivery may be retried. A reviewer can link a report to its subject and decide whether to accept or discard it. Acceptance executes the kind's hook in the same transaction. A refused hook leaves the report unreviewed and commits no application changes.

A reviewer closes a done assignment. A planner can withdraw draft or sent work. Closed and withdrawn assignments refuse reports. An assignee can have at most 100 open assignments.

The reported status includes derived progress. A sent assignment with a report is `working`. A done assignment with every report reviewed is `reviewed`. These values describe progress without changing the underlying send and completion decisions.

## Assignee types

| Type | Caller matching | Delivery path |
| --- | --- | --- |
| Person | The named principal without a grant or peer context | `assignment.inbound` and the report operations on this instance |
| Agent | A grant naming the assigned agent definition | A triggered run submits reports through the feature |
| Device | The paired `device:<id>` principal | Device link and a local worklist |
| Peer | The peer application's service principal | Peer link and the peer's worklist |
| Target | Reports are applied by target sync | An offer effect and inbound replies |

The feature matches a reporting caller to the assignment's assignee inside the transaction. A hidden assignment or report reads as `NOT_FOUND`. Acceptance requires a person, so a delegated agent cannot accept its reports.

### Agent assignees

Sending to an agent writes the kind's offer event. A trigger can start a run scoped to that assignment. Its definition needs the assignment read and report operations together with the done operation. The grant's `creates` field permits the run to create report resources within that scope. [Agents](agents.md#assignments-to-agents) describes run composition.

### Assignment targets

Sending to a target enqueues an offer containing the fixed instructions. Declared instruction blobs are available to its connector through the effect. The target's sync operation associates replies with the named offer, stores their reports and marks the sent assignment done. A refused offer leaves the assignment sent with its rejection reason until the planner withdraws it.

`assignmentTargetPort` runs a supplied function once per offer and retains its result in memory until sync applies it. If the host stops between delivery completion and that sync, the offer can remain completed without its report result. The planner must issue the work again; this in-memory adapter provides no durable result recovery.

### Device and peer assignees

The assignee application keeps a worklist. Its inbound sync reads the issuer's `assignment.inbound` query, which returns the caller's complete open set with a digest cursor. Removing an assignment from that set propagates its withdrawal to the worklist.

Recording a report or done mark in the worklist also enqueues its delivery in the local transaction. The issuer authorizes each delivery as the assignee principal. A refused done mark reopens the worklist assignment. A changed assignee operation schema holds deliveries until the applications agree again.

The assignee's copy of the instructions can become stale. If a report names a resource the assignment no longer covers, the issuer stores the report without that subject. An authorized reviewer can link it later.

## Use

Add a kind with `scaffold add assignment-kind <name> --collection <collection>` from a generated application's root. The scaffold assumes the collection's generated `title` and `status` fields and its `editor` role. Update those references when reshaping the collection or renaming the role.

The package checks run from the framework repository root:

```sh
bun test packages/assignments
```

The [assignment skill](../packages/assignments/skills/assign-work/SKILL.md) describes the feature mount and application hooks. The [package README](../packages/assignments/README.md) identifies the implementation entrypoints.

## Limits

Instruction blobs are unsupported for device and peer assignees because their inbound pull does not download blobs. `defineAssignments` rejects such declarations. A sent assignment retains its assignee; changing who does the work requires withdrawal and a new assignment.

`assignment.inbound` returns the open set without paging. A report skipped by an assignment target's sync leaves no report record. The delivery and review constraints above must be accounted for by the application's recovery procedure.
