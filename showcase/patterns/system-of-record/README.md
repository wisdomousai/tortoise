# Publish a lab request to a LIMS

A technician registers an oil-test request with an enterprise LIMS. The lab desk records the publication locally, then sends it to the LIMS, which can accept, reject or hold it for review. The LIMS change feed also brings requests registered at other sites into the desk.

## Try the fake LIMS

From the repository root:

```sh
cd showcase/patterns/system-of-record
bun run dev:web
```

The development launch starts a fake LIMS on `127.0.0.1:4371`. Create a request, assign a test method and publish it. The publication screen shows the LIMS outcome. The fake LIMS offers controls for a review queue, approval, lost requests and external registrations; the commands below act as its staff:

```sh
curl -X POST localhost:4371/control/review -d '{"on":true}'
curl -X POST localhost:4371/control/approve -d '{"key":"<effect id>"}'
curl -X POST localhost:4371/control/forget -d '{"key":"<effect id>"}'
curl -X POST localhost:4371/control/register -d '{"sample":"OS-24-2001","transformer":"TR-38822","description":"Acidity of aged oil","method":"IEC 62021-1"}'
```

## From publication to outcome

`publication.publish` commits the pending publication and an [outbox effect](../../../docs/primitives.md#outbox-effect) together. After commit, the HTTP connector sends the effect ID as the LIMS idempotency key. A `201` response accepts the publication with a LIMS ID; `422` rejects it with a business reason such as `NO_METHOD`. A `202` response stays pending while the dispatcher looks up the decision. If the LIMS later cannot find a pending request, the effect is held for a technician to reconcile.

The connector reaches only the destination bound by the site policy. Without a binding, publications remain queued. The development policy binds a loopback fake over HTTP; a real deployment needs an appropriate site or internet HTTPS declaration and its own connector validation. The `lims-integration` principal can complete and sync target operations but cannot publish or submit requests.

## Code and checks

[`handlers.ts`](handlers.ts) records publications and outcomes; [`lims-port.ts`](lims-port.ts) builds the REST connector; [`fake-lims.ts`](fake-lims.ts) implements the demo LIMS.

```sh
bun test showcase/patterns/system-of-record
```

The publishing tests cover acceptance, rejection, pending review, reconciliation, inbound sync and a missing destination. They use the fake LIMS, not a live enterprise system.
