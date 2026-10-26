# @agent-native/assignments

This package hands work to an assignee and takes structured reports back for review. An application declares assignment kinds as schemas: what the requester fills in, what the assignee receives, what one report holds and what a reviewer adds on accepting it. The package generates the operations of a [feature](../../docs/glossary.md#feature) with ID `assignment`, and the assignee's side, the worklist, for an application that takes work from another.

## Layer

Framework (`packages/*`). The contracts are browser-safe. The package imports framework packages only, never a plugin, example or sample. Its source is portable, because a worklist runs on a phone.

## Primitives

- Assignment kind: `defineAssignmentKind`, `AssignmentKind`, `AssignmentLane`. A kind lists the lanes that may take it: `person`, `agent`, `device`, `peer` and `target`.
- Assignments: `defineAssignments` returns the feature manifest, the generated operations, one [target](../../docs/glossary.md#target) per target lane (`assignment-<lane>`) and what the device and peer lanes may call.
- Worklist: `defineWorklist` returns the assignee's module, its operations and a [peer target](../../docs/glossary.md#peer-target) whose [feed](../../docs/glossary.md#feed) is the issuer's `assignment.feed`.
- `offerEventType(agentId)`: the [journal](../../docs/glossary.md#journal) event type of an assignment sent to an agent, which a trigger filters on.

Each kind gets four commands: `assignment.<kind>.create`, `.send`, `.report` and `.accept`. Every kind shares these operations:

- `assignment.withdraw`, `assignment.complete` and `assignment.close`;
- the reads `assignment.list`, `assignment.get` and `assignment.feed`;
- `assignment.report.list`, `.get`, `.discard`, and `.place` when a kind's reports name a subject.

A target lane adds `assignment.<lane>.settle`, `.sync` and `.status`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/assignments` | browser and server | `defineAssignmentKind`, `defineAssignments`, `defineWorklist`, `offerEventType` and the schemas. |
| `@agent-native/assignments/*` | browser and server | One source file from `src/`. |

## Trust boundary

The contracts are data. A kind is refused at definition time when:

- its ID or target lane name is invalid or one the generic operations use;
- it lists an unknown or repeated lane, or a target lane without its target;
- it sends brief blobs to a device or a peer, whose pull carries no blobs;
- its accept input has its own `id`.

`defineWorklist` refuses an issuer surface that does not list every operation of the lane.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/kernel` and `@agent-native/integration`. Library: `zod`.

## Tests

```sh
bun test packages/assignments
```

- `test/kind.test.ts`: kind defaults and every refusal.
- `test/operations.test.ts`: the generated operation IDs in a catalog, per-kind targets, blobs and invokes, the generic reads across two kinds, the lane surfaces, and the worklist's operations and refusals.

`bun run test:portable` runs the same tests without the web globals.

## Skills

None yet. The skill for declaring assignment kinds comes with the server part of the feature.

## References

- [Feature](../../docs/glossary.md#feature)
- [Peer target](../../docs/glossary.md#peer-target)
- [Target](../../docs/primitives.md#target)
