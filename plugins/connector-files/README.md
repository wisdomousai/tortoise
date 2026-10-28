# @agent-native/connector-files

The file [connector](../../docs/glossary.md#connector) reaches a [system of record](../../docs/glossary.md#system-of-record) through shared folders. [Outbox effects](../../docs/glossary.md#effect) are dropped as files, and their outcome is read from receipt files or from the archive that the other system moves accepted files into. Result exports in an inbox folder feed [inbound sync](../../docs/glossary.md#inbound-sync).

## Context

This connector is a library without plugin entrypoints. `./contracts` is browser-safe data. Everything else is server only and reaches the file system only through [exchange folders](../../docs/glossary.md#exchange-folder) that the [deployment policy](../../docs/glossary.md#deployment-policy) binds. The other system's files are input.

## Primitives

- [Connector](../../docs/primitives.md#connector): `fileDropPort`, `fileTargetPort`.
- [Inbound sync](../../docs/primitives.md#inbound-sync): `folderFeed`.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `fileExchange`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-files` | server | Everything below except `testing`. |
| `@agent-native/connector-files/contracts` | browser and server | `fileExchange`, the folder declarations. |
| `@agent-native/connector-files/drop` | server | `fileDropPort`: delivery by file drop, with lookup through receipts or the archive. |
| `@agent-native/connector-files/feed` | server | `folderFeed`: inbound sync from a folder of result exports. |
| `@agent-native/connector-files/formats` | server | `parseRecords` and `serializeRecords` for JSON, NDJSON, CSV (RFC 4180) and flat XML. |
| `@agent-native/connector-files/target` | server | `fileTargetPort`: the drop and the feed as one port. |
| `@agent-native/connector-files/testing` | server (tests) | `temporaryFolders` and `FakeFileConsumer`. |

`temporaryFolders` is a folder port over temporary directories that can be unmounted or removed. `FakeFileConsumer` plays the other system: it picks up files, accepts or rejects them and writes receipts.

### Application wiring

- **Manifest:** list `fileExchange({ id, target, description, folders: { drop, receipts, archive, inbox }, dataClasses })` in `components`. It declares one folder requirement per folder: the drop folder as `write`, with `target`, and the others as `read`. The catalog then accepts the outbox target without a network destination.
- **Deployment policy:** bind each folder ID to a directory under `folders`, or disable it with a reason. Code never names a path.
- **`connect`:** build `fileTargetPort({ target, folders: context.folders, drop: { drop, receipts?, archive?, format, encode }, feed: { inbox, format, map } })`. Pass it to the target integration like any other `SystemOfRecordPort`.

Either half may be left out. A target that only reports needs no drop folder, and a target that only receives needs no inbox.

### Delivery

`deliver` writes `<effect id>.<ext>` atomically: it writes a hidden partial file and renames it into place. It returns `pending`, with the file name as the external reference. The [dispatcher](../../docs/glossary.md#dispatcher) then polls `lookup`, which reads in this order:

1. the receipt;
2. the drop folder, where a file is still pending;
3. the receipt again;
4. the archive, where a file is accepted.

A file found in none of them was never delivered. The order is correct only when the other system writes the receipt, or moves the file to the archive, before it removes the file from the drop folder. The other system must also ignore names that start with a dot.

Delivery is not idempotent by itself, because the other system may already have taken the file. The port therefore describes itself as non-idempotent, and the dispatcher looks up before every resend.

Unless `decodeReceipt` says otherwise, a receipt is one of these JSON objects:

- `{ "status": "accepted", "externalRef"? }`;
- `{ "status": "rejected", "code", "message" }`;
- `{ "status": "pending" }`.

A receipt that cannot be read returns the `uncertain` status, which holds the effect for a person. An `encode` refusal is recorded as a rejection. An effect ID that is not a safe file name fails the delivery.

### Inbound sync

The [cursor](../../docs/glossary.md#cursor) is the time a file was received and its name. The received time is the latest of the file's modification, status-change and creation times, because copy tools keep the source's modification time. Each file is read once, and a file replaced later is read again.

A file is read only after it has been quiet for `quietMs`, 2 seconds by default. Dotfiles and other extensions are skipped. A record that `map` refuses, or a file that does not parse, fails the pass instead of being skipped. The inbox is never written to.

## Trust boundary

Parsing accepts only the declared format. The XML reader refuses a DOCTYPE, attributes and nesting, so entity expansion and external references cannot occur. Receipt codes and messages are cut to 100 and 500 characters before they reach state. The application's `map` and the sync command's input schema decide what a record may change.

A folder that the deployment policy disables or does not bind is unavailable through the folder port. Delivery then fails transiently, and the effect waits in the outbox. An unmounted share fails the same way.

Limits:

- the received-time watermark trusts the share's clock, so a file server whose clock runs behind the host can sort a new file before the watermark;
- there is no file locking, and the partial-then-rename write is atomic on one file system but not across a copy tool that writes in place;
- folders are polled, not watched.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/integration`, `@agent-native/kernel` (`plugin`) and `@agent-native/runtime`. The tests use `@agent-native/testing/connectors`. No external packages.

## Tests

```sh
bun test plugins/connector-files
```

`test/connector-files.test.ts` runs the shared connector conformance suite (`@agent-native/testing/connectors`) twice: once with receipts and once with an archive only. An unmounted drop folder is the suite's transient failure. The file also covers:

- each format's round trip and refusals;
- receipts that accept, reject or cannot be read;
- unsafe effect IDs, and a drop with neither receipts nor archive;
- the feed's quiet period, hidden and foreign files, and paging by received time;
- a copied file that keeps an old modification time, a replaced file, and a file that does not parse;
- the component's declarations with and without the folders.

## Task guides

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md): wiring a target, its outbox and inbound sync, with a file exchange as one of the ports.
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md): binding the exchange folders in the deployment policy.
