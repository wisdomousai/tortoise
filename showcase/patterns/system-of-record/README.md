# @agent-native/pattern-system-of-record

`pattern-system-of-record` composes the base pattern unchanged with a [system of record](../../../docs/glossary.md#system-of-record): an enterprise LIMS with a REST API. Registering a test request in the LIMS queues an [outbox](../../../docs/glossary.md#outbox) effect, and the LIMS's response completes a publication record. Requests registered at other sites' LIMS front desks are imported through its change feed as test requests here.

## Layer

Content (`showcase/patterns/*`). It imports the base pattern, the framework, `@agent-native/connector-http` and the site, network and audit plugins.

## Primitives

The pattern is one [application](../../../docs/primitives.md#application). It composes:

- the `lims` [target](../../../docs/primitives.md#target), with its complete, sync and status operations, the `lims-integration` principal and its integration allowlist;
- `publication.publish`, which records a pending publication and enqueues a `test-request.publish` [outbox effect](../../../docs/primitives.md#outbox-effect) in the same transaction;
- a [connector](../../../docs/primitives.md#connector) built with `httpTargetPort`, which the [dispatcher](../../../docs/primitives.md#dispatcher) calls under [worker claims](../../../docs/primitives.md#worker-claims);
- [inbound sync](../../../docs/primitives.md#inbound-sync) from the LIMS change feed, with a watermark cursor in the `publishing` slice;
- [reconciliation](../../../docs/primitives.md#reconciliation) of a held publication, which a technician resolves;
- a [requirement declaration](../../../docs/primitives.md#requirement-declaration) for the `lims-api` destination, which a [deployment policy](../../../docs/primitives.md#deployment-policy) binds;
- the [egress guard](../../../docs/primitives.md#egress-guard) of the network plugin, and the [audit log](../../../docs/primitives.md#audit-log) of the audit plugin, which records outbox transitions and egress connections.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `request-publishing` module: the `publication` collection, `publication.publish`, the `lims` target and the reconciliation operations. The module declares the `lims-api` network destination |
| `domain.ts` | Server | The `publishing` slice: publications and the feed cursor |
| `handlers.ts` | Server | Publishing, the target's complete, sync and status handlers, and reconciliation of held publications |
| `policy.ts` | Server | The route for the `request-publishing` module, with the integration allowlist for the LIMS principal |
| `lims-port.ts` | Server | The REST connector, built with `httpTargetPort` over the network port |
| `fake-lims.ts` | Server, tests and dev | A LIMS on loopback with a review queue, idempotency keys, a by-key lookup and a change feed |
| `application.ts` | Server | The base handlers in the `testRequests` slice, the publishing handlers, both routes, the plugins and `connect`, which connects the target |
| `screens.tsx`, `ui/publishing.tsx` | Browser | The base test request screen with a publishing section, and the publications screen with delivery status and held publications |
| `dev.ts`, `site-policy.dev.json` | Dev launch | Starts the fake LIMS on port 4371 and binds `lims-api` to it |

The dispatcher posts each effect with the effect id as the `Idempotency-Key`. The LIMS responds in one of these ways:

| Response | Result |
| --- | --- |
| 201 | The publication is accepted with the LIMS id |
| 422 | The publication is rejected with the LIMS's code and message, such as `NO_METHOD` for a request without a test method |
| 202 | The publication stays pending in the lab manager's review queue; later passes look it up by key until it is registered |
| 202, then 404 on lookup | Nobody can tell whether the LIMS has the request, so the effect is held for a person, who resolves it through `reconciliation.resolve` |

The change feed adds each request registered at another site once, as `lims-<id>`, with the integration principal as requester.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-system-of-record/manifest` | Browser and server | The test requests module, the request-publishing module and the site, network and audit plugin manifests |
| `@agent-native/pattern-system-of-record/application` | Server | `createTestRequestsSystemOfRecordApplication` |
| `@agent-native/pattern-system-of-record/screens` | Browser | The test request screens with publishing, and the publications screen |

## Trust boundary

The connector reaches the LIMS only through the network port, so the site policy decides where `lims-api` points. The manifest declares it as optional, offline-queued egress to `loopback` over `http`, which fits the fake LIMS; a real deployment declares `site` or `internet` over `https`. Until a site policy binds the destination, publications wait in the outbox.

Complete and sync run as the `lims-integration` principal. Its integration allowlist admits only the target's complete, sync and status operations, so it cannot submit test requests or publish. Publishing needs a technician in the base pattern's members, and resolving a held publication needs a technician who is a person. A publication accepts one delivery at a time, so a late outcome is never applied to a newer one.

## Dependencies

`@agent-native/pattern-base`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`, `@agent-native/connector-http`, `@agent-native/host`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test showcase/patterns/system-of-record/
```

- `test/publishing.test.ts`: against the fake LIMS, a published request is registered with the LIMS id, a request without a test method is rejected with the LIMS's reason, and a reviewed one stays pending until the lookup finds it registered. A publication the LIMS lost is held, a viewer may not resolve it, and a technician's refusal rejects it. A request registered at another site is imported once through the feed. The integration principal and a viewer may not submit requests or publish. Without a bound destination, a publication stays pending and nothing reaches the LIMS.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

Run the pattern in the browser:

```sh
cd showcase/patterns/system-of-record
bun run dev:web
```

The fake LIMS listens on `http://127.0.0.1:4371`. Its controls act as the LIMS's staff:

```sh
curl -X POST localhost:4371/control/review -d '{"on":true}'
curl -X POST localhost:4371/control/approve -d '{"key":"<effect id>"}'
curl -X POST localhost:4371/control/forget -d '{"key":"<effect id>"}'
curl -X POST localhost:4371/control/register -d '{"sample":"OS-24-2001","transformer":"TR-38822","description":"Acidity of aged oil","method":"IEC 62021-1"}'
```

## Skills

- [connect-system-of-record](../../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [add-capability](../../../packages/runtime/skills/add-capability/SKILL.md)

## References

- [Base pattern](../base/README.md)
- [Patterns](../../../docs/patterns.md)
- [Systems of record](../../../docs/systems-of-record.md)
- [HTTP connector](../../../plugins/connector-http/README.md)
