# Publish a lab request to a LIMS

The company's LIMS, its laboratory information management system, keeps the authoritative record of every test request. This pattern adds publication to the [base lab desk](../base/README.md): `publication.publish` commits the pending publication and an outbox effect together, and the HTTP connector then sends the effect ID as the LIMS idempotency key. A `201` accepts, a `422` rejects with a business reason such as `NO_METHOD`, and a `202` leaves the publication pending while the dispatcher looks up the decision; a pending request the LIMS later cannot find is put in `held` for a technician to reconcile. Without a bound destination, publications stay queued.

```sh
cd showcase/patterns/system-of-record
bun run dev:web
```

## What to try

- Create a request (port 4351), assign a method and publish it; the publication screen shows the LIMS outcome.
- Act as LIMS staff against the fake on `127.0.0.1:4371`: `curl -X POST localhost:4371/control/review -d '{"on":true}'` turns on the review queue, `/control/approve -d '{"key":"<effect id>"}'` approves a held publication, `/control/forget` loses one.
- `curl -X POST localhost:4371/control/register -d '{"sample":"OS-24-2001","transformer":"TR-38822","description":"Acidity of aged oil","method":"IEC 62021-1"}'` registers a request at another site, and the feed imports it.
- The `lims-integration` principal completes and syncs the target's operations but cannot publish or submit requests.

## References

- [Systems of record](../../../docs/systems-of-record.md)
- [connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [HTTP connector](../../../plugins/connector-http/README.md)
- `bun test showcase/patterns/system-of-record`
