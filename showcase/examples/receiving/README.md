# Goods receiving

A receiving team counts deliveries against advance shipping notices from an ERP. When a count differs, an editor records a reason before posting the goods receipt. The application saves the count and posting locally; the ERP decides later whether to accept the receipt. A line marked for inspection also creates a request in the separate [quality-inspection application](../quality-inspection/README.md).

## Try the example

From the repository root:

```sh
cd showcase/examples/receiving
bun run dev:web
```

Use `bun run dev` in the same directory for a desktop window. The application starts on port 4330. The default launch has no ERP notice data: bind the exchange folders below and supply a notice to exercise receiving. The tests use temporary folders and a fake ERP; no real ERP or network share has been checked.

## From notice to decision

1. The ERP places a CSV notice in the inbox. Inbound sync validates the whole batch and creates one delivery line per row. Once someone counts a line, later notice updates do not overwrite that count or its expected quantity.
2. An editor records the quantity. If the quantity differs from the notice, the editor gives a reason, or approves a reason requested by the discrepancy agent. The agent cannot classify a line directly.
3. Posting commits the line's pending state and a `goods-receipt.post` [outbox effect](../../../docs/primitives.md#outbox-effect) in one transaction. The file connector writes the receipt after that commit; writing the file acknowledges delivery but does not mean the ERP accepted it.
4. The connector polls for the ERP's response. Acceptance completes the posting; rejection reopens the counted line for another attempt. An unreadable or uncertain response is held for an editor to reconcile.
5. For a line marked `inspect`, the same posting also queues a request to quality inspection. The peer's outcome returns through its feed and appears on the Quality screen.

The notice and posting handlers are in [`handlers/erp-target.ts`](handlers/erp-target.ts); [`erp-port.ts`](erp-port.ts) implements the file exchange. The [systems-of-record guide](../../../docs/systems-of-record.md) explains why local commit and external acceptance are separate.

## Exchange folders

| Folder ID | Access | Contents |
| --- | --- | --- |
| `erp-asn` | read | Advance shipping notice exports, as CSV. |
| `erp-goods-receipts` | write | One goods receipt per posted line, as CSV named `<effect id>.csv`. |
| `erp-receipts` | read | The ERP's response per file, `<effect id>.json`, as the [connector-files README](../../../plugins/connector-files/README.md#delivery) describes. |

The notice CSV has the columns `id`, `purchaseOrder`, `supplier`, `sku`, `description` and `expected`, and an optional `inspect` column whose value `true` marks the line for incoming inspection. The goods receipt CSV has the columns `delivery`, `purchaseOrder`, `sku`, `counted`, `reason` and `note`.

For example, an ERP can place this notice in the bound `erp-asn` folder:

```csv
id,purchaseOrder,supplier,sku,description,expected
ASN-1-1,PO-1,Acme,M8,Bolt,10
```

After an editor counts and posts the line, the drop folder receives a CSV named for the effect. To simulate an ERP acceptance, write a JSON file with the same effect ID and a `.json` extension into the receipts folder:

```json
{ "status": "accepted", "externalRef": "GR-1001" }
```

The application records acceptance when the connector reads that response. Without a response, the goods receipt remains pending.

Create the three directories, then add bindings like these to a complete deployment policy. For a local trial, start with a copy of `apps/desktop/site-policy.json` and replace the example paths with the absolute paths of your directories:

```json
{
  "folders": {
    "erp-asn": { "path": "/srv/erp-share/asn" },
    "erp-goods-receipts": { "path": "/srv/erp-share/goods-receipts" },
    "erp-receipts": { "path": "/srv/erp-share/receipts" }
  }
}
```

Start the example with that policy from `showcase/examples/receiving`:

```sh
AGENT_NATIVE_SITE_POLICY=/absolute/path/to/site-policy.json bun run dev:web
```

Until the folders are bound, no notice is imported and posted receipts wait in the [outbox](../../../docs/glossary.md#outbox). They are delivered once a restarted host finds the folders bound.

## Quality inspection

The target `quality` calls the quality inspection application through the API it publishes in `@agent-native/quality-inspection/contracts/peer`. The deployment policy binds its destination `quality-peer` to that application's address, with `https` off loopback:

```json
{
  "destinations": {
    "quality-peer": {
      "url": "https://quality.plant.example:4320",
      "addresses": ["10.20.0.15/32"],
      "ca": "site-ca.pem"
    }
  }
}
```

An administrator of quality inspection creates an enrollment code on its Peers screen, and an editor here enters it for `quality` on this application's Peers screen. Quality inspection then maps the people who search lots from here to its own people. Until the target is connected, inspection requests wait in the outbox with "connect it on the peers screen", and lot searches report it unavailable.

## Trust boundary

Only workspace members pass the policy's caller gate. Editors count, classify and post, and viewers read. The [integration principal](../../../docs/glossary.md#integration-principal) `erp-integration` holds no role and acts only in the ERP target's [integration allowlist](../../../docs/glossary.md#integration-allowlist).

The `approval` and `reconciliation` features decide their own operations over the access views in `policy.ts`, which apply the same member gate, so `erp-integration` and non-members are refused there too. Any member may request approval. The agent requests approval under the grant of the member who started it, and that grant leaves out `delivery.classify` itself. Approving runs the requested command under the approver, so only an editor's approval commits, and deciding needs a person. Only editors reject approval requests and decide held receipts.

The integration principal `quality-integration` calls only the quality target's operations. Inspection requests are created as this application's service principal there, which may only create inspection requests and read their outcomes. A lot search runs as the person the caller is mapped to in quality inspection, under that person's plant roles; the subject is the caller's principal ID, never input. A caller nobody is mapped to is refused. Lots from quality inspection are parsed before they are shown, and a malformed one is dropped.

Notice rows are input. A row that does not fit the line schema fails the import, so a malformed export is reported instead of half applied. A later export never overwrites a notice line that someone has counted.

## Limits

- **No real ERP.** The exchange has run against temporary directories and `FakeFileConsumer` only, with no network share or mount ([implementation status](../../../docs/implementation-status.md)).
- **Model runs.** The agent scenarios have run with the deterministic harness only ([implementation status](../../../docs/implementation-status.md)).
- **Polling.** Folders are polled, and a file is read only after its quiet period, 2 seconds by default. An export is therefore imported 2 seconds after its last change at the earliest.
- **Share clock.** The feed's watermark uses the share's file times, so a file server whose clock runs behind the host can sort a new file before the watermark.
- **Malformed exports.** A row that fails the line schema fails the whole pass, so notice import stops until the ERP replaces or removes that file.
- **Counted lines.** A corrected notice does not change a line that someone has counted, so the receiver does not see a later change to `expected` on that line.
- **Repeat postings.** A posted line refuses further counts and reasons until its goods receipt is rejected, by the ERP or by a reconciliation decision.
- **Visibility.** Every member sees every line, approval request and held goods receipt, and roles apply to the whole workspace with no container scoping.
- **Integration allowlist.** No example test checks that a person is refused the ERP's sync and complete capabilities.
- **Quality inspection connection.** While `quality` is not connected, `integrations.sync()` fails at that target after the ERP has synced, so the CLI's `sync` reports an error.
- **Lot search.** Quality inspection's lot list pages by offset, so a search returns its first 50 lots only.
- **Peer runs.** The two applications have run as two hosts on one machine only, over loopback and in the peer link's TLS test ([implementation status](../../../docs/implementation-status.md)).
- **No agents marker.** The example's `contracts.ts` has no agents marker, so the scaffold cannot add an agent to it.

## Code and checks

The delivery contract is in [`contracts/delivery.ts`](contracts/delivery.ts), the ERP target in [`contracts/erp-target.ts`](contracts/erp-target.ts), and the peer wiring in [`contracts/quality-peer.ts`](contracts/quality-peer.ts). The line and reconciliation screens live in `ui/`.

```sh
bun test showcase/examples/receiving
bunx playwright test showcase/examples/receiving
```

`test/receiving.test.ts` exercises notice import, posting, rejection and reconciliation against a fake file consumer. `test/quality-peer.test.ts` runs both applications on loopback. The browser tests simulate the ERP response; see [implementation status](../../../docs/implementation-status.md) for recorded live and by-hand evidence.
