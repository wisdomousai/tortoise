# @agent-native/connector-files

A system of record reached through shared folders, as many homebrew MES, test benches and lab systems are. Effects are dropped as files, their outcome is read from receipt files or the archive the other system moves accepted files into, and result exports in an inbox folder feed inbound sync.

Layer: plugins (`plugins/*`). `./component` is browser-safe data; everything else is server only and reaches the file system only through folders the site policy binds. [Connector](../../docs/primitives.md#connector) and [Requirement declaration](../../docs/primitives.md#requirement-declaration) in the primitives index.

## Wiring an application

- **Manifest:** list `fileExchange({ id, target, description, folders: { drop, receipts, archive, inbox }, dataClasses })` in `components`. It declares one folder requirement per folder: the drop folder as `write` carrying `target`, the others as `read`. The catalog then accepts the outbox target without a network destination.
- **Site policy:** bind each folder ID to a directory under `folders`, or disable it with a reason. Code never names a path.
- **`connect`:** build `fileTargetPort({ target, folders: context.folders, drop: { drop, receipts?, archive?, format, encode }, feed: { inbox, format, map } })` and pass it to the target integration as any other `SystemOfRecordPort`.

Either half may be left out: a target that only reports needs no drop folder, and one that only receives needs no inbox.

## Contents

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-files` | server | Everything below |
| `@agent-native/connector-files/component` | browser and server | `fileExchange`, the folder declarations |
| `@agent-native/connector-files/drop` | server | `fileDropPort`: delivery by file drop with lookup through receipts or the archive |
| `@agent-native/connector-files/feed` | server | `folderFeed`: inbound sync from a folder of result exports |
| `@agent-native/connector-files/formats` | server | `parseRecords` and `serializeRecords` for JSON, NDJSON, CSV (RFC 4180) and flat XML |
| `@agent-native/connector-files/target` | server | `fileTargetPort`, both halves as one port |
| `@agent-native/connector-files/testing` | server (tests) | `temporaryFolders` (a folder port over temporary directories that can be unmounted or removed) and `FakeFileConsumer` (the other system, picking up, accepting, rejecting and writing receipts) |

### Delivery

`deliver` writes `<effect id>.<ext>` atomically, as a hidden partial file renamed into place, and returns `pending` with the file name as the external reference. The dispatcher then polls `lookup`, which reads, in order: the receipt, the drop folder (still pending), the receipt again, and the archive (accepted). A file found in none of them was never delivered.

That order is sound only if the other system keeps one rule: it writes the receipt, or moves the file to the archive, before it removes the file from the drop folder, and it ignores names starting with a dot. Delivery is not idempotent by itself, since the other system may already have taken the file, so the port describes itself as non-idempotent and the dispatcher looks up before every resend.

A receipt is JSON `{ "status": "accepted", "externalRef"? }`, `{ "status": "rejected", "code", "message" }` or `{ "status": "pending" }` unless `decodeReceipt` says otherwise. A receipt that cannot be read makes the outcome `uncertain`, which holds the effect for a person. An `encode` refusal is recorded as a rejection. An effect ID that is not a safe file name fails the delivery.

### Inbound sync

The cursor is the time a file arrived and its name. Arrival is the latest of the file's modification, status-change and creation times, because copy tools keep the source's modification time. Each file is read once, and a file replaced later is read again. A file is read only after it has been quiet for `quietMs` (default 2 s), and dotfiles and other extensions are skipped. A record that `map` refuses, or a file that does not parse, fails the pass instead of being skipped. The inbox is never written to.

## Trust boundary

The other system's files are input. Parsing accepts only the declared format: the XML reader refuses a DOCTYPE, attributes and nesting, so entity expansion and external references cannot occur. Receipt codes and messages are cut to 100 and 500 characters before they reach state. The application's `map` and the sync command's input schema decide what a record may change.

A folder the site policy disables, or does not bind, is unavailable through the folder port, so delivery fails transiently and the effect waits in the outbox. An unmounted share is the same failure.

Limits:

- the arrival watermark trusts the share's clock; a file server whose clock runs behind the host can sort a new file before the watermark;
- no file locking: the partial-then-rename write is atomic on one file system, not across a copy tool that writes in place;
- folders are polled, not watched.

## Tests

```sh
bun test plugins/connector-files
```

`test/connector-files.test.ts` runs the shared connector conformance suite (`@agent-native/testing/connectors`) once with receipts and once with an archive only. An unmounted drop folder is the suite's transient failure. It also covers each format's round trip and refusals, receipts that accept, reject or cannot be read, unsafe effect IDs, a drop with neither receipts nor archive, the feed's quiet period, hidden and foreign files and paging by arrival, a copied file that keeps an old modification time, a replaced file, a file that does not parse, and the component's declarations with and without the folders.

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md): wiring a target, its outbox and inbound sync, with a file exchange as one of the ports.
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): binding the exchange folders in the site policy.
