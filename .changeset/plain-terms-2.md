---
'@tortoise/adapters': minor
'@tortoise/agents': minor
'@tortoise/assignments': minor
'@tortoise/client': minor
'@tortoise/contracts': minor
'@tortoise/event-log': minor
'@tortoise/frame': minor
'@tortoise/frame-native': minor
'@tortoise/host': minor
'@tortoise/integration': minor
'@tortoise/kernel': minor
'@tortoise/mobile': minor
'@tortoise/observation': minor
'@tortoise/operator-ui': minor
'@tortoise/react': minor
'@tortoise/runtime': minor
'@tortoise/scaffold': minor
'@tortoise/testing': minor
'@tortoise/audit': minor
'@tortoise/compliance': minor
'@tortoise/connector-driver': minor
'@tortoise/connector-files': minor
'@tortoise/connector-http': minor
'@tortoise/connector-mqtt': minor
'@tortoise/connector-opcua': minor
'@tortoise/deployment': minor
'@tortoise/device-link': minor
'@tortoise/execution-host': minor
'@tortoise/hub-link': minor
'@tortoise/peer-link': minor
'@tortoise/webhook': minor
'@tortoise/workflows': minor
'@tortoise/screen-bridge': minor
'@tortoise/workstation-sign-in': minor
---

Plain terms replace five more overfit ones: feed, brief, surface, posture and receipt. The glossary and primitives carry a `Do not use:` line for each.

Breaking changes:

- Inbound sync: the target declaration field `feed` is `inbound` in `defineTarget`, `definePeerTarget`, `createPeerPort` (`PeerPortOptions.feed`), `fileTargetPort` and `httpTargetPort`. `definePeerTarget` returns `inboundQuery` in place of `feedQuery`. In `@tortoise/connector-files`, `folderFeed` is `folderInbound` and `FolderFeedOptions` is `FolderInboundOptions`. In `@tortoise/assignments`, `anyFeedItemSchema`, `FeedItemOf` and `AnyFeedItemOf` are `anyInboundItemSchema`, `InboundItemOf` and `AnyInboundItemOf`. The glossary entry Feed is part of Inbound sync.
- Operation IDs: `assignment.feed` is `assignment.inbound` (and `operations.feed` is `operations.inbound`, its UI binding likewise), and `inspection.request.feed` in the quality-inspection example is `inspection.request.outcomes`. The assignment kind ID `feed` is reserved as `inbound`. The `my-assignments` registry component takes `inbound` in place of `feed`, and its type `FeedItem` is `InboundItem`.
- Instructions: the assignment kind field `brief` is `instructions`, `blobs.brief` is `blobs.instructions`, and the `byKind` and `AssignmentHooks` hook `brief` is `instructions`. A stored or returned assignment carries `instructions` in place of `brief`. The `my-assignments` and `worklist` slots `brief` are `instructions`. An assignment written before this change keeps `brief` in its stored record, which nothing reads. Start with a new data directory.
- Channel: the glossary entries Surface and Surface adapter are Channel and Channel adapter. The channel values in the execution context and audit records are unchanged. The documentation anchor `architecture#surfaces-and-identity` is `architecture#channels-and-identity`.
- Public API review: `scripts/reviewed-surface.json` is `scripts/reviewed-api.json`, `scripts/skill-surface.ts` is `scripts/skill-api.ts`, and `bun run check:skills` reports "public API changed" in place of "surface changed". `bun run skills:stamp` keeps its name. A generated application that copied `scripts/reviewed-surface.json` renames it.
- Compliance status: `@tortoise/compliance` renames `Posture` to `ComplianceStatus`, `PostureCheck` to `ComplianceCheck`, `DestinationPosture` to `DestinationStatus`, `PostureInput` to `ComplianceInput`, `assessPosture` to `assessCompliance`, `postureMarkdown` to `complianceMarkdown`, `createPostureMonitor` and `PostureMonitor` to `createComplianceMonitor` and `ComplianceMonitor`, and the schemas `postureSchema`, `postureCheckSchema` and `destinationPostureSchema` to `complianceStatusSchema`, `complianceCheckSchema` and `destinationStatusSchema`. The monitor method `posture()` is `status()`.
- Compliance operations: the capability `compliance.posture.get` is `compliance.status.get` (`complianceOperations.statusGet`), the UI binding `compliance-posture` is `compliance-status`, and the prompt `review-compliance-posture` is `review-compliance-status`. The screen heading is "Compliance status". `app compliance report` prints "Compliance status: <application>" and its JSON key `posture` is `compliance`.
- Audit log: the event kind `posture.checked` is `compliance.checked`. An audit log written before this change keeps `posture.checked` events, which remain valid kinds, and the verifier still checks the chain.
- Command result: `CommandReceipt` is `CommandResult` and `StoredReceipt` is `StoredResult` in `@tortoise/runtime`, `StoredResult.receipt` is `commandResult`, and `WorkspaceSnapshot.receipts` is `commandResults`. The row storage retention option `receipts` is `commandResults`, and the row kind `receipt` is `commandResult`. `Receipt` in `@tortoise/client` is `CommandResult`, `PeerReceipt` in `@tortoise/integration` is `PeerCommandResult`, and the recorded call field `receipt` in `@tortoise/testing` agent scenarios and the `receipt` result of an observer submission are `commandResult`. A workspace written before this change keeps its stored `receipts`, which nothing reads: repeated idempotency keys run the command again, and snapshot storage fails on the first command that carries a key. Start with a new data directory.
- Unchanged: `goods receipt` in the receiving example, the `receipts` folder and receipt files of `@tortoise/connector-files` (the other system's acknowledgement of a file), and the `OperatorSurface` component.
