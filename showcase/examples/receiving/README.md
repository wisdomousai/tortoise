# Goods receiving

A receiving team counts deliveries against advance shipping notices from an ERP. When a count differs, an editor records a reason before posting the goods receipt. The application saves the count and the posting locally; the ERP decides later whether to accept the receipt. A line marked for inspection also creates a request in the [quality-inspection application](../quality-inspection/README.md). Three exchange folders stand in for the ERP.

Make the folders and a site policy:

```sh
mkdir -p /tmp/erp/asn /tmp/erp/goods-receipts /tmp/erp/receipts
cp apps/desktop/site-policy.json /tmp/erp/site-policy.json
```

Add this key to `/tmp/erp/site-policy.json`:

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
AGENT_NATIVE_SITE_POLICY=/tmp/erp/site-policy.json bun run dev:web
```

## What to try

- `bun run --silent cli delivery list --output text` lists `ASN-1-1` with status `expected`. An `inspect` column set to `true` sends a line to quality inspection.
- Count and post: `bun run --silent cli delivery receive --id ASN-1-1 --counted 10 --key r1`, then `bun run --silent cli erp send --id ASN-1-1 --key p1`. The line shows `sync: pending` and a file `<effect id>.csv` appears in `/tmp/erp/goods-receipts`. A count that differs from `expected` needs a reason first.
- Answer as the ERP: write `{ "status": "accepted", "externalRef": "GR-1001" }` to `/tmp/erp/receipts/<effect id>.json`. After the next poll, `cli delivery get --id ASN-1-1` shows `status: posted` and `sorRef: GR-1001`. `{ "status": "rejected" }` reopens the line.
- Until you bind the folders, the inbox imports nothing and posted receipts wait in the outbox.

## References

- [Systems of record](../../../docs/systems-of-record.md): why the local commit and the ERP's acceptance are separate
- [connector-files: delivery](../../../plugins/connector-files/README.md)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md)
- `bun test showcase/examples/receiving`, `bunx playwright test showcase/examples/receiving`
