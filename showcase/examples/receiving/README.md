# Goods receiving

This hypothetical receiving application imports advance shipping notices through exchange folders. An editor records a discrepancy reason when the counted quantity differs from the notice, then submits the posting. The local posting remains pending until the simulated ERP returns its outcome.

A line marked for inspection can request work through the configured [quality-inspection application](../quality-inspection/README.md). The exchange folders act as a file-based ERP fixture. They are not evidence of a deployed ERP connection.

Make the folders and a deployment policy:

```sh
mkdir -p /tmp/erp/asn /tmp/erp/goods-receipts /tmp/erp/receipts
cp apps/desktop/deployment-policy.json /tmp/erp/deployment-policy.json
```

Add this key to `/tmp/erp/deployment-policy.json`:

```json
{
  "folders": {
    "erp-asn": { "path": "/tmp/erp/asn" },
    "erp-goods-receipts": { "path": "/tmp/erp/goods-receipts" },
    "erp-receipts": { "path": "/tmp/erp/receipts" }
  }
}
```

Drop a notice and start the app with the policy. The launch prints a `CLI:` line; export its two variables in a second terminal.

```sh
printf 'id,purchaseOrder,supplier,sku,description,expected\nASN-1-1,PO-1,Acme,M8,Bolt,10\n' > /tmp/erp/asn/asn-1.csv
cd showcase/examples/receiving
TORTOISE_DEPLOYMENT_POLICY=/tmp/erp/deployment-policy.json bun run dev:web
```

## What to try

`bun run --silent cli delivery list --output text` lists `ASN-1-1` with status `expected`. An `inspect` column set to `true` sends a line to quality inspection.

Count and post: `bun run --silent cli delivery receive --id ASN-1-1 --counted 10 --key r1`, then `bun run --silent cli erp send --id ASN-1-1 --key p1`. The line shows `sync: pending` and a file `<effect id>.csv` appears in `/tmp/erp/goods-receipts`. A count that differs from `expected` needs a reason first.

Answer as the ERP: write `{ "status": "accepted", "externalRef": "GR-1001" }` to `/tmp/erp/receipts/<effect id>.json`. After the next poll, `cli delivery get --id ASN-1-1` shows `status: posted` and `sorRef: GR-1001`. `{ "status": "rejected" }` reopens the line.

Until you bind the folders, the inbox imports nothing and posted receipts wait in the outbox.

On a line whose count differs, ask the discrepancy classifier in the assistant panel. It proposes a reason as an approval request, which an editor approves on **Approvals** or on the line. Without a model, the panel runs the deterministic demo, which takes a script instead of a request.

## References

[Systems of record](../../../docs/systems-of-record.md): why the local commit and the ERP's acceptance are separate

[connector-files: delivery](../../../plugins/connector-files/README.md)

Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md)

`bun test showcase/examples/receiving`, `bunx playwright test showcase/examples/receiving`
