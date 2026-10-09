# 009 — Remote queries and adoption

Accepted. Serves [P7](../principles.md#p7--other-systems-change-only-through-durable-intents), with consequences for [P5](../principles.md#p5--committed-changes-reach-every-authorized-view) and [P6](../principles.md#p6--status-says-what-is-known).

**Context.** The framework fronted systems of record only by writing through the outbox and pulling a feed in the background. Nothing could reach another system at the moment a person or agent asked, so "search the CRM as I type" could not be built. Mirroring the whole system of record would answer searches locally. But it would copy records the caller may not see under that system's own sharing rules, and hold far more than the work needs.

**Decision.**

- **A remote query is a declared query.** It names its target, and composition rejects a target without a declared destination. It stays read-only.
- **The runtime makes the call, never the handler.** The handler only builds the request and maps the results. The runtime authorizes, calls the source outside any transaction with a deadline and cancellation, then authorizes again before returning. A revocation during the call drops the result.
- **The caller's identity reaches the source.** The source uses the caller's own credential, so the other system applies its own sharing rules. A service credential is used only where the query declares that fallback. Local policy still filters the result.
- **Failure is a status, not an error.** An unavailable source returns a labeled, empty result, and local work continues. Denial and cancellation remain errors, because they are answers about the caller.
- **Nothing found is stored.** Results are point-in-time and carry their fetch time. The audit trail records that a call happened, not what it found. Paging uses the source's opaque cursors.
- **Adoption is a domain command.** Bringing a found record into local state is a command with an outbound intent. The record's content then arrives through inbound sync under the integration principal, never from the caller's input.

**Consequences.**

- An application can put a live search of another system in front of people and agents without mirroring that system.
- Each remote query costs a round trip, so screens debounce, and change notifications never refetch.
- A deployment must connect caller credentials to its vault.
- What adoption means is left to each domain.

**Alternatives considered.**

- Mirroring through inbound sync: copies records outside the caller's rights, and is stale between pulls.
- Calling the source from handlers: the call would run inside the transaction and could not be re-authorized.
- Page numbers: they shift as the source changes, and cannot be bound to the caller.
- Returning record content in delivery outcomes: content would then flow from caller-influenced input.
