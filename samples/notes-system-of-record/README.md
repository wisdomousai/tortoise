# @agent-native/sample-notes-system-of-record

`sample-notes-system-of-record` composes the [notes sample](../notes/README.md) unchanged with a [system of record](../../docs/glossary.md#system-of-record): a REST publisher. Publishing a note queues an [outbox](../../docs/glossary.md#outbox) effect; the publisher's answer settles a publication record, and notes posted on the publisher's site arrive through its change feed.

## Layer

Content (`samples/*`). It imports the base sample, the framework, `@agent-native/connector-http` and the site, network and audit plugins.

## Primitives

The sample is one [application](../../docs/primitives.md#application). Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `note-publishing` module: the `publication` collection, `publication.publish`, the `publisher` [target](../../docs/primitives.md#target) and the reconciliation operations. The module declares the `publisher-api` network destination |
| `domain.ts` | Server | The `publishing` slice: publications and the feed cursor |
| `handlers.ts` | Server | Publishing, the target's settle, sync and status handlers, and reconciliation of held publications |
| `policy.ts` | Server | The route for the `note-publishing` module, with the integration lane for the publisher principal |
| `publisher-port.ts` | Server | The REST connector, built with `httpTargetPort` over the network port |
| `fake-publisher.ts` | Server, tests and dev | A publisher on loopback with moderation, idempotency keys, a by-key lookup and a change feed |
| `application.ts` | Server | The base handlers in the `notes` slice, the publishing handlers, both routes, the plugins and `connect`, which connects the target |
| `screens.tsx`, `ui/publishing.tsx` | Browser | The base note screen with a publishing section, and the publications screen with delivery status and held publications |
| `dev.ts`, `site-policy.dev.json` | Dev launch | Starts the fake publisher on port 4361 and binds `publisher-api` to it |

`publication.publish` records a pending publication and enqueues `note.publish` in the same transaction. The dispatcher posts it with the effect id as the `Idempotency-Key`. The publisher answers in one of these ways:

| Answer | Result |
| --- | --- |
| 201 | The publication is accepted with the publisher's id |
| 422 | The publication is rejected with the publisher's code and message |
| 202 | The publication stays pending; later passes look it up by key until it is live |
| 202, then 404 on lookup | Nobody can tell whether the publisher has it, so the effect is held for a person, who resolves it through `reconciliation.resolve` |

The change feed adds each note posted on the publisher's site once, as `site-<id>`, with the integration principal as author.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-notes-system-of-record/manifest` | Browser and server | The notes module, the note-publishing module and the site, network and audit plugin manifests |
| `@agent-native/sample-notes-system-of-record/application` | Server | `createNotesSystemOfRecordApplication` |
| `@agent-native/sample-notes-system-of-record/screens` | Browser | The note screens with publishing, and the publications screen |

## Trust boundary

The connector reaches the publisher only through the network port, so the site policy decides where `publisher-api` points. The manifest declares it as optional, offline-queued egress to `loopback` over `http`, which fits the fake publisher; a real deployment declares `site` or `internet` over `https`. Until a site policy binds the destination, publications wait in the outbox.

Settle and sync run as the `publisher-integration` principal. Its lane admits only the target's settle, sync and status operations, so it cannot add notes or publish. Publishing needs an editor in the base sample's members, and resolving a held publication needs an editor who is a person. A publication accepts one delivery at a time, so a late outcome never lands on a newer one.

## Dependencies

`@agent-native/sample-notes`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`, `@agent-native/connector-http`, `@agent-native/host`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test samples/notes-system-of-record
```

- `test/publishing.test.ts`: against the fake publisher, a published note is accepted with the publisher's id, an empty note is rejected with the publisher's reason, and a moderated one stays pending until the lookup finds it live. A publication the publisher lost is held, a viewer may not resolve it, and an editor's refusal rejects it. A posted note arrives once through the feed. The integration principal and a viewer may not add notes or publish. Without a bound destination, a publication stays pending and nothing reaches the publisher.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample or the base.

Run the sample in the browser:

```sh
cd samples/notes-system-of-record
bun run dev:web
```

The fake publisher listens on `http://127.0.0.1:4361`. Its controls act as the publisher's staff:

```sh
curl -X POST localhost:4361/control/moderate -d '{"on":true}'
curl -X POST localhost:4361/control/approve -d '{"key":"<effect id>"}'
curl -X POST localhost:4361/control/forget -d '{"key":"<effect id>"}'
curl -X POST localhost:4361/control/post -d '{"title":"From the site","text":"Posted there"}'
```

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Systems of record](../../docs/systems-of-record.md)
- [HTTP connector](../../plugins/connector-http/README.md)
