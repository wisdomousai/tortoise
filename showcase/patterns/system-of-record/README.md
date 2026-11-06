# Publish a lab request to a LIMS

This pattern connects the hypothetical [base application](../base/README.md) to a fake LIMS through the HTTP connector. `publication.publish` commits an outbox effect with the publication state. The connector sends the effect identifier as the external idempotency key.

The fake supports business rejection and delayed decisions. An acknowledged publication whose outcome is no longer known becomes held for reconciliation. Without the required destination binding, delivery remains queued.

```sh
cd showcase/patterns/system-of-record
bun run dev:web
```

## What to try

Create a request (port 4351), assign a method and publish it; the publication screen shows the LIMS outcome.

Act as LIMS staff against the fake on `127.0.0.1:4371`: `curl -X POST localhost:4371/control/review -d '{"on":true}'` turns on the review queue, `/control/approve -d '{"key":"<effect id>"}'` approves a held publication, `/control/forget` loses one.

`curl -X POST localhost:4371/control/register -d '{"sample":"OS-24-2001","transformer":"TR-38822","description":"Acidity of aged oil","method":"IEC 62021-1"}'` registers a request at another plant, and inbound sync imports it.

The `lims-integration` principal is limited to the target's completion and sync operations.

## References

[Systems of record](../../../docs/systems-of-record.md)

[connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)

[HTTP connector](../../../plugins/connector-http/README.md)

`bun test showcase/patterns/system-of-record`
