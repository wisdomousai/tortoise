# @agent-native/crm-capture

Field sales capture against a CRM that stays the system of record. People and agents search the CRM live, as they type, with their own CRM access. Results are not stored. Picking one _adopts_ the account into the local working set, where it is kept current by the CRM's feed and can carry activities (calls, visits, notes) that go back to the CRM through the outbox. When the CRM is unreachable, search says so and everything already adopted keeps working.

Layer: content (`examples/*`). The fake CRM ([`fake-crm.ts`](fake-crm.ts), seeded from [`fake-crm/seed.ts`](fake-crm/seed.ts), paged by [`fake-crm/cursor.ts`](fake-crm/cursor.ts)) is a demo and test fixture that lives here only. Its records use Salesforce-style field names to show the mapping; nothing here talks to Salesforce.

## Primitives

This example is one [Application](../../docs/primitives.md#application) and the reference for live search of a system of record. It composes:

- two [data providers](../../docs/primitives.md#data-provider), `crm.account` and `crm.contact`, declared in [`contracts/providers.ts`](contracts/providers.ts). Each one becomes a `search` and a `lookup` [Remote query](../../docs/primitives.md#remote-query) in the [Catalog](../../docs/primitives.md#catalog), so the screen, MCP, the CLI and HTTP all call the same capability;
- a [Module](../../docs/primitives.md#module) of local `crm.*` [capabilities](../../docs/primitives.md#capability) for adopted accounts, activities and sync status;
- adoption and activity forwarding through [Outbox effects](../../docs/primitives.md#outbox-effect), a [Dispatcher](../../docs/primitives.md#dispatcher) and [Inbound sync](../../docs/primitives.md#inbound-sync), wired with `createTargetIntegration`;
- a [Requirement declaration](../../docs/primitives.md#requirement-declaration) for the `crm-api` destination, which carries both the outbox target and the remote reads;
- [capability bindings](../../docs/primitives.md#capability-binding): `remoteInfiniteQueryOptions` for the paged search box, `liveQueryOptions` for adopted accounts, `useCapabilityForm` for activities.

Read the [system-of-record pattern](../../docs/system-of-record-pattern.md#live-search-and-adoption) for the design, and [ADR 009](../../docs/decisions/009-remote-queries-and-adoption.md) for why search is a query and adoption a command. The generated [operation reference](../../docs/reference/crm-capture/operations.md) lists every operation.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                                                                  |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/crm-capture/manifest`    | browser and server | Default export: `defineManifest` with id `crm-capture` and its module.                                                    |
| `@agent-native/crm-capture/application` | server only        | Default export: the application with the demo CRM. `createCrmCaptureApplication` takes another port, services or members. |
| `@agent-native/crm-capture/screens`     | browser            | Default export: `defineScreens` with Search (home), Accounts and the account detail.                                      |
| `@agent-native/crm-capture/*`           | see file           | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-crm`.                              |

`contracts` composes `contracts/schemas`, `contracts/providers` and `contracts/operations`, which are browser-safe like it. `server` concatenates one handler group per concern from `handlers/`: the provider item mappers (`providers`), local reads (`accounts`), adopt and activity capture (`capture`), and the integration principal's sync and settle commands (`integration`). They share `handlers/context`.

The provider handlers never call the CRM. `implementDataProvider` gives the runtime two pure steps: the search input is the source request, and each record the CRM returns is parsed, scoped to the caller's regions and marked with its local status. The runtime calls the source between those steps, through `createRemoteSource` over `FakeCrm.search`. That is the one place where per-caller CRM credentials are resolved.

Adopting is a domain command, not something the provider generates, because what adoption means depends on the domain. `crm.account.adopt` records the account as `following` and enqueues `account.follow`. The CRM checks the requester's own access when the effect is delivered and either accepts or rejects it. The feed then delivers the followed account's record to `crm.account.sync`, which sets it to `adopted` and keeps it current. Record content therefore always comes from the integration principal, never from the caller, and an `EffectOutcome` never has to carry a record.

`ui/search.tsx` debounces the input (250 ms) and runs both providers through `remoteInfiniteQueryOptions`: the previous result stays on screen while the next one loads, and every keystroke aborts the superseded request down to the source. The CRM answers five records per page; "Show more from the CRM" (`ui/search/more-results.tsx`) sends the last page's `next` back as `cursor`. An agent pages the same way by passing `cursor` to the next tool call. A live list of local accounts overlays each result's adopt status, so adopting updates the result row without a new CRM search. `ui/search/source-line.tsx` shows where and when a result came from, and which identity answered.

| Command (in this directory)       | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `bun run dev` / `bun run dev:web` | Desktop window or browser on port 4324 with the fake CRM. |

Run it from the root with `AGENT_NATIVE_APPLICATION=@agent-native/crm-capture`; `app.config.json` names another application by default. The demo signs the owner in to the fake CRM as `ann`. `DEMO_CRM_LOGIN=ben` picks the other user, and `DEMO_CRM_LOGIN=none` leaves the owner without a login, so search falls back to the service account. `DEMO_CRM_LATENCY_MS` slows searches so the in-between state is visible, and `DEMO_CRM_UNAVAILABLE=1` makes the CRM unreachable.

## Trust boundary

Members of the workspace may search, adopt and log activities, scoped to their regions. The integration principal (`INTEGRATION_PRINCIPAL`) may only sync accounts, settle effects and read the sync status. It cannot search, so a delivery worker can never read the CRM with a person's credential. A delegated agent's context principal is its delegator, so it searches with that person's CRM access, within the operations its grant names.

Both providers declare `caller-or-service`. A caller with their own CRM login searches with it, and the CRM applies its own sharing rules (Ann sees her accounts and public ones, never Ben's private ones). A caller without a login is answered by the service account, and only rows in the member's regions survive the item mapper. The source line on screen says which identity answered. Policy projection runs on the result either way, and the runtime authorizes again after the CRM answers, so a revocation during the call drops the result.

Page cursors are bound to the search text and the CRM user that produced them. The owner's login cannot continue a page the service account fetched, and no cursor carries over to another search; the CRM refuses both with `INVALID_INPUT`. Region scoping runs on every page, so a service-account page can come back short or empty while `next` still points further.

Search input goes to the CRM. Results go to the caller and are never stored or journaled; the audit records the target, status, identity and item count, never the query or the rows. CRM error text never reaches the caller, except an `UNAVAILABLE` message the source marked as safe. In the fake CRM, credentials are demo strings held in memory. A deploying application backs `CallerCredentials` with its vault and never reads keys from input.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/react`, `@agent-native/frame`, and `@agent-native/client`, `@agent-native/adapters` and `@agent-native/testing` (tests). Screens use the frame's session and shadcn components through the `@/` alias. External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router`, `lucide-react`. Content must never import `apps/*` ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application)).

## Tests

```sh
bun test examples/crm-capture
bunx playwright test examples/crm-capture/e2e
```

| Test                       | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/application.test.ts` | Search with the caller's CRM sharing; service fallback limited to the member's regions, page by page; a cursor refused under another credential or search; adopt → feed → adopted and kept current; a CRM refusal to follow; activities forwarded after commit; an unreachable CRM as a status while local work continues; a delegated agent searching as its delegator within its grant; outsiders and the integration principal refused.                       |
| `test/conformance.test.ts` | One provider answers direct, HTTP, CLI and MCP with the same result; a cursor from HTTP continues over MCP; MCP marks search read-only and open-world; adopt over MCP settles like adopt from the screen ([P1](../../docs/principles.md#p1--every-operation-is-executable-from-ui-mcp-cli-and-api), [P7](../../docs/principles.md#p7--other-systems-are-changed-only-through-durable-intents)).                                                                  |
| `test/ui-bindings.test.ts` | Every operation that claims a UI binding is referenced by a screen.                                                                                                                                                                                                                                                                                                                                                                                              |
| `e2e/search.pw.ts`         | Chromium: a first page and "Show more" to the end, search as you type with the previous result kept while loading, a private account never shown, adopt from following to adopted without a refresh, a contact leading to its account, an activity reaching the CRM, and the unavailable state with the local list still usable ([P12](../../docs/principles.md#p12--an-application-runs-beside-the-work-and-keeps-working-without-central-systems-or-a-model)). |

The fake CRM proves the wiring and the trust order, not a real CRM's API. A live probe against a real system needs an explicitly configured account and is recorded separately in the [implementation status](../../docs/implementation-status.md).
