# Systems of record

A system of record is an outside system (ERP, MES, CRM, quality system) that owns records your app changes. Your command never calls it directly. The command writes an outbox effect in its own transaction, and a dispatcher delivers it afterwards.

Examples: `quality-inspection` (fake quality system), `crm-capture` (fake CRM, live reads), `receiving` (ERP over shared folders).

To add one to your app, follow [connect-system-of-record](../packages/integration/skills/connect-system-of-record/SKILL.md).

## Targets

A target declares one system of record. It creates three capabilities that only the integration principal can call (status is open to everyone).

```ts
// showcase/examples/quality-inspection/contracts/target.ts
export const qualityTarget = defineTarget({
  target: 'quality-system',
  resourceType: 'Synchronization',
  operations: {
    complete: 'inspection.effect.complete', // dispatcher records the outcome
    sync: 'inspection.lot.sync', // inbound sync applies a batch
    status: 'inspection.sync.status', // anyone: pending, accepted, rejected counts
  },
  changes: ['lot', 'result', 'defect'],
  feed: { item: lotSnapshotSchema, max: 200, changes: ['lot'] },
  // status: ..., descriptions: ...
});
```

Without a `feed`, the target only delivers. `targetHandlers(qualityTarget, {...})` builds the three handlers; you supply how an outcome changes your record and how a feed item changes local state.

## Outbox and completion

A handler enqueues an effect next to the record it changed:

```ts
// showcase/examples/quality-inspection/handlers/capture.ts
const defect = {
  id, lotId: lot.id, code: input.code, quantity: input.quantity,
  sync: 'pending' as const,
  effectId: ctx.enqueue({
    target: TARGET,
    type: 'defect.post',
    resource: `defect:${id}`,
    payload: { lot: lot.id, code: input.code, quantity: input.quantity },
  }),
};
```

Then wire the target in `application.ts`:

```ts
connect: ({ application, workspaceId }) => ({
  integrations: [
    connectTarget({ target: qualityTarget, application, port: demoSystemOfRecord(),
      workspaceId, principalId: INTEGRATION_PRINCIPAL, toInput: toSyncInput }),
  ],
}),
```

What happens next:

| Step                               | Rule                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Commit                             | State, receipt, journal and effect commit together. A replayed command adds no effect. |
| Delivery                           | Every second. At least once, so the target must dedupe by effect ID or offer a lookup. |
| Transient failure                  | The dispatcher retries with backoff from 1 s to 60 s.                                 |
| Business rejection                 | The complete command records `rejected`. No retry.                                    |
| Outcome                            | The complete command writes it. The record gets `sync`, `sorRef` or `rejection`.      |

To see it, start the example and ask for the target's status:

```sh
bun run --cwd showcase/examples/quality-inspection dev:web
# second terminal, from the repo root:
export TORTOISE_CONNECTION=$PWD/showcase/examples/quality-inspection/.workspace/.connection.json
bun run cli inspection sync status --output text
```

You should see `watermark`, `lastSyncAt`, then `pending`, `accepted`, `rejected` and `retrying` counts.

## Worker claims

Before sending, the dispatcher claims the effect for 120 s with a growing fencing token. A stalled worker's late write fails with `CONFLICT`. Two dispatchers on one target need different worker names.

Before the first claim, the dispatcher re-checks that the committer is still allowed. If not, it holds the effect.

## Held effects

The dispatcher holds an effect when nobody knows if the target applied it:

- delivery broke off mid-send;
- the lookup can't tell;
- the target forgot an effect it acknowledged;
- the re-check before the first claim denied the committer.

The dispatcher never retries a held effect. A person resolves it through the `reconciliation` feature: **applied** (accepted), **refused** (rejected) or **not applied** (the dispatcher sends it again). Mount it with `reconciliationFeature`, a `ReconciliationAccess` view and an `onResolved` hook. Delegated callers (agents) can't resolve.

A target may also return `pending` (acknowledged). The dispatcher then polls its lookup instead of resending.

## Effect phases

`effectPhase(effect)` returns one of:

| Phase                    | Meaning                                    |
| ------------------------ | ------------------------------------------ |
| `queued`                 | committed, never tried                     |
| `claimed`                | a worker holds it                          |
| `retrying`               | failed, waiting for backoff                |
| `acknowledged`           | target has it, hasn't decided              |
| `held`                   | waiting for a person                       |
| `accepted` / `rejected`  | done                                       |
| `cancelled`              | withdrawn with `ctx.cancelEffect` before any claim |

## Inbound sync

Inbound sync pulls changes after the stored watermark every 5 s and submits them through the target's sync command. A stale range fails with `CONFLICT`, so two pullers can't apply the same page. If the feed can send old versions late, set the `versions` option on `targetHandlers`.

## Connectors

A connector implements `SystemOfRecordPort`. Ready-made ones:

| Connector                                                       | Talks to                                             |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| [connector-http](../plugins/connector-http/README.md)           | REST APIs. Needs an idempotency header or a lookup.  |
| [connector-files](../plugins/connector-files/README.md)         | Shared folders: drop files, read receipt files.      |
| [connector-driver](../plugins/connector-driver/README.md)       | Equipment behind a [driver](hardware-drivers.md).    |
| [screen bridge](../workstations/screen-bridge/README.md)        | A desktop application, through its screen.           |
| [peer port](../packages/integration/README.md#peer-applications) | Another agent-native app ([below](#peer-applications)). |

[connector-mqtt](../plugins/connector-mqtt/README.md) and [connector-opcua](../plugins/connector-opcua/README.md) only read, as observations. Each connector ships a fake for tests.

## Remote queries

A remote query reads the outside system when the caller asks and stores nothing. Use it when callers must only see what the source lets them see (`crm-capture`).

Declare a data provider for one target and build both handlers with `implementDataProvider`. The source call runs outside the transaction with a 10 s deadline, and the runtime authorizes the result again before returning it.

### Credentials and paging

The query uses the caller's own credential. An agent uses the delegating person's. The query uses a service credential only if it declares that fallback. Paging uses the source's opaque cursor; the list ends when no cursor comes back.

### Failures and followed records

A down or slow source returns status `unavailable` with a short safe message. To keep a result, the caller runs a domain command (in `crm-capture`, "follow"), which enqueues an effect; inbound sync then brings the record in.

## Peer applications

A peer target is another agent-native app in the role of a system of record. Follow [connect-two-applications](../plugins/peer-link/skills/connect-two-applications/SKILL.md).

1. The called app declares a peer API with `definePeerApi` and composes the [peer link](../plugins/peer-link/README.md) plugin.
2. The calling app declares `definePeerTarget` and wires it with `connectPeerTarget`.
3. An admin of the called app creates a one-use enrollment code on its Peers screen; enter it on the caller's Peers screen.
4. The called app's admin maps each subject to a local person with `peer.subject.map`.
5. Commands enqueue `target.effect(command, { resource, payload })`. They run at the peer as `peer:<id>` or as the mapped person.

If the peer's schema drifts, its effects stay pending and its reads go unavailable until the contracts match again.

## Command line

`bun run build:cli` builds a single binary at `dist/bin/<name>` that needs no Bun. Every capability is a subcommand with typed flags:

```sh
app inspection result record --lot-id 4000001 --characteristic-id C10 --value 220.01 --occurred-at 1791370306000 --key r-1
```

- `--json '{...}'` passes the whole input; `--dry-run` only validates.
- `help`, `list`, `schema`, `workflows` work without an instance.
- `serve`, `mcp`, `sync` (pull once), `drain` (deliver until empty), `backup`, `restore`, `migrate` operate the workspace.

An orchestrator keeps a sandbox's workspace until `drain` exits 0. `bun run test:sandbox` tests the compiled binary.

### Exit codes

| Exit | Error code                   | Meaning                                                                    |
| ---- | ---------------------------- | -------------------------------------------------------------------------- |
| 0    |                              | success                                                                    |
| 1    | `INTERNAL`, `INVALID_OUTPUT` | internal failure; `app status` unverified release; `driver check` failed; lease lost |
| 2    | `INVALID_INPUT`              | bad input or usage; `site check` / `network export` errors                 |
| 3    | `NOT_FOUND`                  | not found                                                                  |
| 4    | `FORBIDDEN`                  | forbidden                                                                  |
| 5    | `CONFLICT`                   | conflict, including a workspace another instance holds                     |
| 6    | `IDEMPOTENCY_CONFLICT`       | key reused with different input                                            |
| 7    | `CANCELLED`                  | cancelled                                                                  |
| 8    | `UNAVAILABLE`                | unavailable                                                                |
| 10   |                              | `audit verify` chain damaged; `compliance report` failing                  |
| 75   |                              | `drain`: effects still waiting                                             |

## Limits

- The fake quality system and fake CRM live in memory, per process.
- The peer link can't rotate its key; revoke the peer and connect again.
