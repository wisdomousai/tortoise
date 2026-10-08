# 009 — Remote queries and adoption

Accepted. Amends [P7](../principles.md#p7--other-systems-are-changed-only-through-durable-intents) and touches [P5](../principles.md#p5--every-committed-change-reaches-every-authorized-view-whatever-its-origin), [P6](../principles.md#p6--status-reports-what-is-known-not-what-is-hoped), [P12](../principles.md#p12--an-application-runs-beside-the-work-and-keeps-working-without-central-systems-or-a-model) and [P13](../principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does). A query may declare that it reads another system. The runtime calls that system outside any transaction, with the caller's own credential, and never stores what it found. Bringing a found record into the application is a command.

**Context.** The framework claimed to front systems of record but reached them only by writing through the outbox and pulling a feed in the background. Nothing could reach the system of record at the moment a person or agent _asked_. "Search the CRM as I type" could not be built: P7 ruled out calling a remote system from a handler, and queries run inside `storage.read`. Mirroring the whole CRM through inbound sync would answer searches locally, but it copies records the caller may not be allowed to see under the CRM's own sharing rules, and it holds far more than the work needs.

**Decision.**

- **A remote query is a declared query.** A capability carries `remote: { target, identity }`. Composition rejects a remote target that no network destination `reads`, just as it rejects an undeclared outbox target (P13). MCP marks it open-world, and it remains read-only.
- **The runtime calls the source, never the handler.** A remote handler has two pure steps:
  1. `request` builds the source query from input and state;
  2. `item` maps each returned record, or drops it.

  The runtime runs them in this order:
  1. authorize, then `request` in a read snapshot;
  2. call `sources[target]` outside any transaction, with a deadline and the caller's cancellation signal;
  3. in a fresh snapshot, authorize again, map the items, project, validate, and authorize once more.

  A revocation while the source answered drops the result. Mutating state in either step fails.

- **Identity is per caller.** The source receives the execution context and resolves the caller's own credential, so the system of record applies its own sharing rules. A delegated agent's context principal is its delegator. A service credential is used only when the query declares `caller-or-service`, and the runtime refuses a service answer to a `caller` query. Without either credential, the source refuses with `FORBIDDEN`. Local policy projects the result in every case.
- **Failure is a status.** The result is `{ items, source: { target, status, fetchedAt, identity, message } }`. An unreachable, slow or missing source returns `unavailable` with a caller-safe message, and local data keeps working (P12). Provider error text passes only as an `UNAVAILABLE` message the source marked safe. `FORBIDDEN` and cancellation stay errors, because they are answers about the caller, not about the source.
- **Nothing is stored.** The audit records the target, status, identity and item count, never the query or the items (P13). Remote results are point-in-time. They carry their fetch time and are not refreshed by the journal (P5, P6). In React, `remoteQueryOptions` keeps the previous result while the next one loads and is never refetched by change batches. It is still reset by an authorization change.
- **Paging belongs to the source.** Search input carries an optional opaque `cursor`, and a result carries the source's `next`. The runtime passes both through and bounds the cursor to 512 characters. The source binds a cursor to the search and the credential that produced it, so replaying it under another identity is refused rather than read. Only a missing `next` ends the list, because local scoping can empty a page.
- **A data provider is the unit.** `defineDataProvider` declares `<id>.search` and `<id>.lookup` from one query schema and one item schema. `implementDataProvider` supplies the item mapper, and `createRemoteSource` adapts a `SystemOfRecordPort.search` with `CallerCredentials`. Because the provider becomes ordinary catalog entries, the screen, MCP, the CLI and HTTP call the same capability (P1).
- **Adoption is a domain command.** The provider does not generate it. In the CRM example, `adopt` commits a local record and an outbox effect; the system of record checks the requester's access on delivery; and the feed then brings the record's content through inbound sync. Record content therefore comes from the integration principal, never from the caller's input, and `EffectOutcome` stays free of record payloads.

**Consequences.**

- An application can put a live search of its system of record in front of people and agents without mirroring it, and without a handler holding a client.
- Every remote query costs a round trip to another system. Change batches never refetch it, and screens debounce input.
- A deploying application must bind `CallerCredentials` to its vault. The example's fake keeps demo credentials in memory.
- What adoption means is left to each domain. Only one example proves the pattern, with two providers, so the primitives are `partial`.

**Alternatives considered.**

- Mirroring the system of record through inbound sync: copies records outside the caller's sharing, grows without bound, and is stale between pulls.
- Letting handlers call the source: the source call would run inside the storage transaction, could not be authorized again after it returns, and would let any handler reach a network.
- Offsets or page numbers in the contract: they shift as the source changes and leave the source no way to bind a page to the caller. Opaque cursors leave both to the source.
- Streaming results: they would need request-scoped streams on every transport. One result per keystroke covers search as you type.
- Returning record content in `EffectOutcome`: settlement would then write data the caller influenced through the effect, and every outcome would grow a payload. The feed already carries content under the integration principal.
- Generating `adopt` from the provider: local state, policy and what the system of record must be told all differ by domain.
