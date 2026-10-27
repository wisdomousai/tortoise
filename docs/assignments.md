# Assignments

An [assignment](glossary.md#assignment) hands work to an [assignee](glossary.md#assignee) with a [brief](glossary.md#brief) and takes structured [reports](glossary.md#assignment-report) back. A person reviews each report, then accepts it into the [application](glossary.md#application)'s records or discards it. The `assignment` [feature](glossary.md#feature) keeps assignments and reports, and generates their operations from the application's [assignment kinds](glossary.md#assignment-kind).

## Concepts

Terms: [assignment](glossary.md#assignment), [assignment kind](glossary.md#assignment-kind), [assignment report](glossary.md#assignment-report), [assignee](glossary.md#assignee), [brief](glossary.md#brief) and [worklist](glossary.md#worklist).

An [outbox effect](glossary.md#effect) asks a [system of record](glossary.md#system-of-record) to change its records, and the system of record decides. An assignment asks an assignee to do work and report what it found. A person in the issuing application decides what each report changes. These applications use assignments:

- `samples/notes-assignments`: an editor sends a review of some notes to a member, the reviewer agent or a peer application, and accepts each verdict into its note.
- `samples/notes-worklist`: the peer application that takes those reviews and reports back over the [peer link](glossary.md#peer-link).
- `examples/asset-survey`: a survey of part of the plant structure goes to a paired phone or a person, and each capture is a report on one node. An extraction sends one capture to the model or a person to read.
- `examples/asset-survey-field`: the phone's worklist of surveys.

## Assignment kinds

A kind declares its data as schemas:

- **scope**: what the planner fills in;
- **brief**: what the assignee receives, computed from the scope when the assignment is sent;
- **report**: one report's body, with its blob limits;
- **subject**: the resource type a report is about, when reports name a record;
- **accept**: what the reviewer adds when accepting;
- **lanes**: the assignee types that may take it, and the target of the target lane;
- **invokes** and **changes**: the operations the accept hook calls and the resource types it changes.

The browser-safe `defineAssignments` turns the kinds into the feature's manifest and operations. Each kind gets a create, send, report and accept command. Every kind shares the commands to withdraw, complete and close an assignment, the reads and the feed, and the commands that place and discard reports.

The application mounts the feature with an access view and hooks. The application's [policy](glossary.md#policy) never sees the feature's operations, so the access view repeats the application's membership gate. The hooks check a scope, compute a brief, decide whether an assignment covers a subject, and write the application's records when a report is accepted. The `byKind` helper builds them from one implementation per kind.

## Lifecycle

1. A planner creates the assignment as a draft, or creates and sends it in one command.
2. Sending checks the lane and the assignee, computes the brief and keeps it unchanged.
3. The assignee reports. A report keeps the ID its reporter chose, so a repeated delivery returns the stored report. A different body under that ID is a conflict.
4. The assignee marks the assignment done. A done assignment still takes its assignee's reports, because a retried delivery can arrive after the done mark.
5. A reviewer places, accepts or discards each report. Accepting runs the kind's accept hook in the same transaction. A refused hook writes nothing and leaves the report new.
6. A reviewer closes the done assignment. A planner may withdraw a draft or a sent one. Neither a closed nor a withdrawn assignment takes reports.

The stage adds two states to the status: `working` is sent with at least one report, and `reviewed` is done with every report reviewed. An assignee holds at most 100 open assignments.

## Lanes

| Lane | Assignee matched as | Transport |
| --- | --- | --- |
| Person | The principal, with no grant and no peer | The feed and the report commands on the same instance |
| Agent | A run whose grant names the agent definition | A trigger on the offer event starts the run, which calls the report command |
| Device | `device:<id>`, the paired device's principal | The device link; the phone keeps a worklist |
| Peer | The peer application's service principal | The peer link; the peer application keeps a worklist |
| Target | Never a caller; the lane's sync stores its reports | An outbox offer, answered through the target's feed |

The feature's policy decides every operation inside the transaction. It matches the caller to the assignee itself, so a member cannot report on another member's work. An assignment or a report the caller cannot see reads as not found. Accepting is person-only, so an agent run cannot accept its own reports.

### Agent lane

Sending to an agent writes a [journal](glossary.md#journal) entry whose event type names the agent. A [trigger](glossary.md#trigger) on that event type starts an [agent run](glossary.md#agent-run) scoped to the assignment. The agent definition lists the assignment read, the kind's report command and the done mark. Its `creates` field lets the scoped run create report resources.

### Target lane

Sending to a [target](glossary.md#target) enqueues an offer effect with the brief. The brief's blobs are attached to the assignment, so the target's connector reads them through the effect. The lane's sync applies each answer to the offer it names while the assignment is sent: it stores the reports and marks the assignment done. A refused offer stays sent with the target's reason until the planner withdraws it.

The `assignmentTargetPort` runs a function, such as a model call, once per offer. It keeps each answer in memory until the lane's sync applies it. If the host stops in between, the offer stays settled without its answer, and the planner sends the work again.

### Device and peer lanes

The assignee's application keeps a worklist. Its [inbound sync](glossary.md#inbound-sync) pulls the issuer's feed, which lists the caller's whole open set with a digest cursor. An assignment the feed no longer lists takes no more reports there, so a withdrawal reaches the assignee.

The worklist records a report or a done mark and enqueues its delivery in one transaction, so the work waits out a lost connection. The issuer authorizes each delivery again as the assignee's principal. A refused done mark reopens the assignment in the worklist. A change to one of the lane's operations at the issuer holds deliveries until the two applications agree.

The assignee reports from its own copy of the brief, which may be out of date. A report on a record the assignment no longer covers is stored without its subject, and a person places it.

## Use

Run the notes sample with assignments in the browser:

```sh
cd samples/notes-assignments
bun run dev:web
```

Add a person-lane kind over a collection to an application made by the scaffold:

```sh
bun run scaffold add assignment-kind inspection --collection note
```

Run the tests of the package, the samples and the asset survey:

```sh
bun test packages/assignments
bun test samples/notes-assignments samples/notes-worklist
bun test examples/asset-survey examples/asset-survey-field
```

## Limits

- A brief sent to a device or a peer carries no blobs, because the feed pull downloads none. A kind that declares brief blobs for these lanes is refused.
- A sent assignment keeps its assignee. The planner withdraws it and sends a new one to someone else.
- The feed carries an assignee's whole open set in one batch, without paging.
- A report that the target lane's sync skips is not recorded.

## References

- [Assignments package](../packages/assignments/README.md)
- [assign-work](../packages/assignments/skills/assign-work/SKILL.md)
- [Notes assignments sample](../samples/notes-assignments/README.md)
- [Notes worklist sample](../samples/notes-worklist/README.md)
- [Asset survey example](../examples/asset-survey/README.md)
- [Asset survey field example](../examples/asset-survey-field/README.md)
- [Agents](agents.md)
- [Systems of record](systems-of-record.md)
