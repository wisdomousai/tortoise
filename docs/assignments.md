# Assignments

An assignment hands work to an assignee with a brief and takes structured reports back. A person reviews each report, then accepts it into the application's records or discards it. The `assignment` feature keeps assignments and reports, generating their operations from the application's assignment kinds.

An outbox effect asks a system of record to change its records, and the system of record decides. An assignment is different: it asks an assignee to do work and report what it found, and a person in the issuing application decides what each report changes.

These applications use assignments:

- `showcase/examples/asset-survey` — a survey of part of the plant structure goes to a paired phone or a person, and each capture is a report on one node
- `showcase/examples/asset-survey-field` — the phone's worklist of surveys
- `showcase/patterns/assignments` — a technician sends a sampling round to a member or a field crew and accepts each sample reported back
- `showcase/patterns/worklist` — the field crew's application that takes those rounds and reports back over the peer link

## Kind declarations

A kind declares its data as schemas:

- **scope** — what the planner fills in
- **brief** — what the assignee receives, computed from the scope when the planner sends the assignment
- **report** — one report's body, with its blob limits
- **subject** — the resource type a report is about, when reports name a record
- **accept** — what the reviewer adds when accepting
- **assignee types** — who may take it, and the target's name when one is a target
- **invokes** and **changes** — the operations the accept hook calls and the resource types it changes

`defineAssignments` turns the kinds into the feature's manifest and operations. Each kind gets:

- a create command
- a send command
- a report command
- an accept command

Every kind shares the commands to withdraw, complete and close an assignment, the reads and the feed, and the commands that link and discard reports.

The application mounts the feature with an access view and hooks. The application's policy never sees the feature's operations, so the access view repeats the membership gate.

Hooks:

- Check a scope and an assignee
- Compute a brief
- Decide whether an assignment covers a subject
- Write the application's records when a reviewer accepts a report

The `byKind` helper builds them from one implementation per kind.

## Lifecycle

1. A planner creates the assignment as a draft, or creates and sends it in one command.
2. Sending checks the assignee type and the assignee, computes the brief and keeps it unchanged.
3. The assignee reports. A report keeps the ID its reporter chose, so a repeated delivery returns the stored report. A different body under that ID is a conflict.
4. The assignee marks the assignment done. A done assignment still takes its assignee's reports, because a retried delivery can come in after the done mark.
5. A reviewer links, accepts or discards each report. Accepting runs the kind's accept hook in the same transaction. A refused hook writes nothing and leaves the report new.
6. A reviewer closes the done assignment. A planner may withdraw a draft or a sent one. Neither a closed nor a withdrawn assignment takes reports.

Sending adds two derived states to the status:

- `working` — sent with at least one report
- `reviewed` — done with every report reviewed

An assignee has at most 100 open assignments.

## Assignee types

| Assignee type | Assignee matched as | Transport |
| --- | --- | --- |
| Person | The principal, with no grant and no peer | The feed and the report commands on the same instance |
| Agent | A run whose grant names the agent definition | A trigger on the offer event starts the run, which calls the report command |
| Device | `device:<id>`, the paired device's principal | The device link; the phone keeps a worklist |
| Peer | The peer application's service principal | The peer link; the peer application keeps a worklist |
| Target | Never a caller; the target's sync stores its reports | An outbox offer, with replies from the target's feed |

The feature's policy decides every operation inside the transaction, matching the caller to the assignee so a member cannot report on another member's work. An assignment or report the caller cannot see reads as not found. Accepting is person-only — an agent run cannot accept its own reports.

### Agent assignees

Sending to an agent writes a journal entry whose event type names the agent. A trigger on that event type starts a run scoped to the assignment. The definition lists:

- the assignment read
- the kind's report command
- the done mark

Its `creates` field lets the scoped run create report resources.

### Assignment targets

Sending to a target enqueues an offer effect with the brief. The assignment includes the brief's blobs, so the target's connector reads them through the effect. The target's sync applies each reply to the offer it names while the assignment stays sent: it stores the reports and marks the assignment done. A refused offer stays sent with the target's reason until the planner withdraws it.

`assignmentTargetPort` runs a function, such as a model call, once per offer. It keeps each result in memory until the target's sync applies it. If the host stops in between, the offer stays completed without its result, and the planner sends the work again.

### Device and peer assignees

The assignee's application keeps a worklist. Inbound sync pulls the issuer's feed, which lists the caller's whole open set with a digest cursor. An assignment the feed no longer lists takes no more reports, so a withdrawal reaches the assignee.

The worklist records a report or a done mark and enqueues its delivery in one transaction, so work waits out a lost connection. The issuer reauthorizes each delivery as the assignee's principal. A refused done mark reopens the assignment in the worklist. A change to one of the assignee operations at the issuer puts deliveries in `held` until the two applications agree.

The assignee reports from its own copy of the brief, which may be out of date. The feature stores a report on a record the assignment no longer covers without its subject, and a person links it.

## Use

Run the assignments pattern in the browser:

```sh
cd showcase/patterns/assignments
bun run dev:web
```

Add an assignment kind for person assignees over a collection to an application made by the scaffold:

```sh
bun run scaffold add assignment-kind inspection --collection note
```

The generated kind reads the collection's `title` and `status` fields and names the `editor` role. A reshaped collection or a renamed role needs the same change in the kind.

Run the tests of the package, the patterns and the asset survey:

```sh
bun test packages/assignments
bun test showcase/patterns/assignments/ showcase/patterns/worklist/
bun test showcase/examples/asset-survey showcase/examples/asset-survey-field
```

Run the patterns' screens in Chromium, with person and peer assignees:

```sh
bunx playwright test showcase/patterns/assignments showcase/patterns/worklist
```

## Limits

- A brief sent to a device or a peer includes no blobs, because the feed pull downloads none. `defineAssignments` refuses a kind that declares brief blobs for these assignee types.
- A sent assignment keeps its assignee. The planner withdraws it and sends a new one to someone else.
- The feed includes an assignee's whole open set in one batch, without paging.
- A report that an assignment target's sync skips leaves no record.

## References

- [Assignments package](../packages/assignments/README.md)
- [assign-work](../packages/assignments/skills/assign-work/SKILL.md)
- [Assignments pattern](../showcase/patterns/assignments/README.md)
- [Worklist pattern](../showcase/patterns/worklist/README.md)
- [Asset survey example](../showcase/examples/asset-survey/README.md)
- [Asset survey field example](../showcase/examples/asset-survey-field/README.md)
- [Agents](agents.md)
- [Systems of record](systems-of-record.md)
