# @agent-native/crm-capture

`crm-capture` is field sales capture against a CRM that stays the [system of record](../../docs/glossary.md#system-of-record). People and agents search the CRM live as they type, with their own CRM access, and the results are not stored. Picking a result adopts the account into the local working set, where the CRM's feed keeps it current and activities go back to the CRM.

The example is the reference for live search of a system of record; [systems of record](../../docs/systems-of-record.md#capture-screens) explains the design, including why search is a query and adoption a command. When the CRM is unreachable, search says so, and everything already adopted keeps working.

## Layer

Content (`examples/*`). The fake CRM in [`fake-crm.ts`](fake-crm.ts) is a demo and test fixture that lives here only. [`fake-crm/seed.ts`](fake-crm/seed.ts) seeds it, and [`fake-crm/cursor.ts`](fake-crm/cursor.ts) pages it. Its records use Salesforce-style field names to show the mapping. Nothing here talks to Salesforce.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- two [data providers](../../docs/primitives.md#data-provider), `crm.account` and `crm.contact`, declared in [`contracts/providers.ts`](contracts/providers.ts). Each becomes a `search` and a `lookup` [remote query](../../docs/primitives.md#remote-query) in the [catalog](../../docs/primitives.md#catalog), so the screen, MCP, the CLI and HTTP call the same capability.
- a [module](../../docs/primitives.md#module) of local `crm.*` [capabilities](../../docs/primitives.md#capability) for adopted accounts, activities and sync status.
- adoption and activity forwarding through [outbox effects](../../docs/primitives.md#outbox-effect), a [dispatcher](../../docs/primitives.md#dispatcher) and [inbound sync](../../docs/primitives.md#inbound-sync). They are declared once as a [target](../../docs/primitives.md#target) in `contracts/target.ts` and wired with `connectTarget`.
- a [requirement declaration](../../docs/primitives.md#requirement-declaration) for the `crm-api` destination, which carries both the outbox target and the remote reads.
- the `site`, `network`, `audit` and `compliance` [host plugins](../../docs/primitives.md#host-plugin). The manifest and the application list all four. The screens compose the compliance plugin's Compliance screen, and the plugin adds the `compliance.*` queries.
- [capability bindings](../../docs/primitives.md#capability-binding): `remoteInfiniteQueryOptions` for the paged search box, `liveQueryOptions` for adopted accounts and `useCapabilityForm` for activities.

`bun run generate` writes the capability reference to `dist/reference/crm-capture/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/crm-capture/manifest` | browser and server | Default export: `defineManifest` with ID `crm-capture` and its module. |
| `@agent-native/crm-capture/application` | server only | Default export: the application with the demo CRM. |
| `@agent-native/crm-capture/screens` | browser | Default export: `defineScreens` with Search (home), Accounts and the account detail. |
| `@agent-native/crm-capture/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-crm`. |

`createCrmCaptureApplication` takes another port, services or members. `contracts` composes `contracts/schemas`, `contracts/providers` and `contracts/operations`, which are browser-safe like it.

`server` concatenates one handler group per concern from `handlers/`, and the groups share `handlers/context`:

- `providers`: the provider item mappers;
- `accounts`: local reads;
- `capture`: adopt and activity capture;
- `integration`: the integration principal's sync and settle commands.

### Live search

The provider handlers never call the CRM. `implementDataProvider` gives the runtime two pure steps. The first turns the search input into the source request. The second parses each record the CRM returns, scopes it to the caller's regions and marks it with its local status.

The runtime calls the source between those steps, through `createRemoteSource` over `FakeCrm.search`. That is the one place where per-caller CRM credentials are resolved.

`ui/search.tsx` debounces the input by 250 ms and runs both providers through `remoteInfiniteQueryOptions`. The previous result stays on screen while the next one loads. Every keystroke aborts the superseded request down to the source.

The CRM answers five records per page. "Show more from the CRM" (`ui/search/more-results.tsx`) sends the last page's `next` back as `cursor`. An agent pages the same way by passing `cursor` to the next tool call.

A live list of local accounts overlays each result's adopt status, so adopting updates the result row without a new CRM search. `ui/search/source-line.tsx` shows where and when a result came from, and which identity answered.

### Adoption

Adopting is a domain command, because what adoption means depends on the domain. The data provider does not generate it.

1. `crm.account.adopt` records the account as `following` and enqueues `account.follow`.
2. When the effect is delivered, the CRM checks the caller's own access and accepts or rejects it.
3. The feed delivers the followed account's record to `crm.account.sync`, which sets it to `adopted` and keeps it current.

Record content always comes from the [integration principal](../../docs/glossary.md#integration-principal). The caller cannot supply it, and an `EffectOutcome` never has to carry a record.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4324 with the fake CRM. |
| `bun run dev:web` | Browser on port 4324 with the fake CRM. |

To run it from the repository root, set `AGENT_NATIVE_APPLICATION=@agent-native/crm-capture`. `app.config.json` names another application by default.

The demo signs the owner in to the fake CRM as `ann`. These variables change the demo:

- `DEMO_CRM_LOGIN=ben` picks the other CRM login;
- `DEMO_CRM_LOGIN=none` leaves the owner without a login, so search falls back to the service account;
- `DEMO_CRM_LATENCY_MS` slows searches so the in-between state is visible;
- `DEMO_CRM_UNAVAILABLE=1` makes the CRM unreachable.

## Trust boundary

Members of the workspace may search, adopt and log activities, scoped to their regions. The integration principal (`INTEGRATION_PRINCIPAL`) may only sync accounts, settle effects and read the sync status. It cannot search, so a delivery worker can never read the CRM with a person's credential.

A delegated agent's context principal is its delegator. The agent searches with that person's CRM access, within the capabilities its [grant](../../docs/glossary.md#grant) names.

Both providers declare `caller-or-service`. A caller with a CRM login searches with it, and the CRM applies its own sharing rules. Ann sees her accounts and public ones, and does not see Ben's private ones. The service account answers a caller without a login, and only rows in the member's regions survive the item mapper. The source line on screen says which identity answered.

Policy projection runs on the result in both cases. The runtime authorizes again after the CRM answers, so a revocation during the call drops the result.

Page cursors are bound to the search text and the CRM login that produced them. The owner's login cannot continue a page the service account fetched, and no cursor carries over to another search. The CRM refuses both with `INVALID_INPUT`. Region scoping runs on every page. A service-account page can therefore come back short or empty while `next` still points further.

Search input goes to the CRM. Results go to the caller and are never stored or journaled. The [audit log](../../docs/glossary.md#audit-log) records the target, status, identity and item count, and leaves out the query and the rows. CRM error text does not reach the caller, except an `UNAVAILABLE` message the source marked as safe.

In the fake CRM, credentials are demo strings held in memory. A deploying application backs `CallerCredentials` with its [credential vault](../../docs/glossary.md#credential-vault) and never reads keys from input.

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/react`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit` and `@agent-native/compliance`. The tests also use `@agent-native/client`, `@agent-native/adapters` and `@agent-native/testing`.

Screens use the frame's session and shadcn components through the `@/` alias. External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/crm-capture
bunx playwright test examples/crm-capture/e2e
```

- `test/application.test.ts`:
  - search applies the caller's CRM sharing;
  - the service fallback is limited to the member's regions, page by page;
  - a cursor is refused under another credential or search;
  - adopt, then the feed, leads to adopted, and the account is kept current;
  - the CRM refuses to follow;
  - activities are forwarded after commit;
  - an unreachable CRM shows as a status while local work continues;
  - a delegated agent searches as its delegator within its grant;
  - outsiders and the integration principal are refused.
- `test/conformance.test.ts`:
  - one provider answers directly, over HTTP, the CLI and MCP with the same result;
  - a cursor from HTTP continues over MCP;
  - MCP marks search read-only and open-world;
  - adopt over MCP settles like adopt from the screen.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `e2e/search.pw.ts`, in Chromium:
  - a first page, then "Show more" to the end;
  - search as you type, with the previous result kept while loading;
  - a private account is never shown;
  - adopt moves from following to adopted without a refresh;
  - a contact leads to its account;
  - an activity reaches the CRM;
  - the unavailable state leaves the local list usable.

The fake CRM proves the wiring and the trust order. It does not prove a real CRM's API. A live probe against a real system needs an explicitly configured account, and its result is recorded in the [implementation status](../../docs/implementation-status.md).

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers data providers, the target and adoption.
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md) and [build-screens](../../packages/frame/skills/build-screens/SKILL.md) cover the local capabilities and the screens.
