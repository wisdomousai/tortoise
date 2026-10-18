# @agent-native/crm-capture

`crm-capture` is field sales capture against a CRM that stays the [system of record](../../docs/glossary.md#system-of-record). People and agents search the CRM live as they type, with their own CRM access, and the results are not stored. Picking a result adopts the account into the local working set, where the CRM's feed keeps it current and activities go back to the CRM.

The example is the reference for live search of a system of record; [systems of record](../../docs/systems-of-record.md#capture-screens) explains the design, including why search is a query and adoption a command. When the CRM is unreachable, search says so, and everything already adopted keeps working.

## Layer

Content (`examples/*`). The fake CRM in [`fake-crm.ts`](fake-crm.ts) is a demo and test fixture that lives here only. Its records use Salesforce-style field names to show the mapping. Nothing here talks to Salesforce.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- two [data providers](../../docs/primitives.md#data-provider), `crm.account` and `crm.contact`, declared in [`contracts/providers.ts`](contracts/providers.ts). Each becomes a `search` and a `lookup` [remote query](../../docs/primitives.md#remote-query) in the [catalog](../../docs/primitives.md#catalog), so the screen, MCP, the CLI and HTTP call the same capability.
- a [module](../../docs/primitives.md#module) of local `crm.*` [capabilities](../../docs/primitives.md#capability) for adopted accounts, activities and sync status.
- adoption and activity forwarding through [outbox effects](../../docs/primitives.md#outbox-effect), a [dispatcher](../../docs/primitives.md#dispatcher) and [inbound sync](../../docs/primitives.md#inbound-sync). They are declared once as a [target](../../docs/primitives.md#target) in `contracts/target.ts` and wired with `connectTarget`.
- a [requirement declaration](../../docs/primitives.md#requirement-declaration) for the `crm-api` destination, which carries both the outbox target and the remote reads.
- the `site`, `network`, `audit` and `compliance` [host plugins](../../docs/primitives.md#host-plugin). The screens compose the compliance plugin's Compliance screen, and the plugin adds the `compliance.*` queries.
- [capability bindings](../../docs/primitives.md#capability-binding): `remoteInfiniteQueryOptions` for the paged search box, `liveQueryOptions` for adopted accounts and `useCapabilityForm` for activities.

`bun run generate` writes the capability reference to `dist/reference/crm-capture/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/crm-capture/manifest` | browser and server | Default export: `defineManifest` with ID `crm-capture` and its module. |
| `@agent-native/crm-capture/application` | server only | Default export: the application with the demo CRM. |
| `@agent-native/crm-capture/screens` | browser | Default export: `defineScreens` with Search (home), Accounts and the account detail. |
| `@agent-native/crm-capture/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-crm`. |

`createCrmCaptureApplication` takes another port, services or members.

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

## Demonstrated mechanisms

Paths in this section are relative to the example directory unless they start with `packages/`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Data provider](../../docs/primitives.md#data-provider) | `contracts/providers.ts`: `crmAccounts`, `crmContacts` (`defineDataProvider`) | `test/application.test.ts`: "search reads the CRM live with the caller’s own access" |
| [Remote query](../../docs/primitives.md#remote-query) with an item mapper | `handlers/providers.ts`: `implementDataProvider` with `item` | Same test; `packages/runtime/test/remote-query.test.ts` |
| Remote source for a [remote query](../../docs/primitives.md#remote-query), with caller credentials and a service fallback | `application.ts`: `sources.crm` (`createRemoteSource`); `fake-crm.ts`: `credentials` | `test/application.test.ts`: "without a CRM login…"; `packages/integration/test/remote-source.test.ts` |
| Source cursors bound to the search and the credential | `fake-crm/cursor.ts`: `page` | `test/application.test.ts`: "a page cursor continues only its own search…" |
| Unreachable source reported as a status | `fake-crm.ts`: `DeliveryFailure` in `search`; `ui/search.tsx`: `LocalFallback` | `test/application.test.ts`: "when the CRM is unreachable…"; `e2e/search.pw.ts`: second test |
| [Execution context](../../docs/primitives.md#execution-context) of a delegated agent, searching as its delegator | `packages/integration/src/remote-source.ts`: `access` reads `call.context.principalId` | `test/application.test.ts`: "an agent delegated by a person searches with that person’s access…" |
| [Target](../../docs/primitives.md#target) | `contracts/target.ts`: `crmTarget` (`defineTarget`) | `test/application.test.ts`: "adopting follows the account in the CRM…" |
| [Outbox effect](../../docs/primitives.md#outbox-effect) enqueued by a command | `handlers/capture.ts`: `ctx.enqueue` for `account.follow` and `activity.create` | `test/application.test.ts`: "activities go to the CRM after the local commit…" |
| [Dispatcher](../../docs/primitives.md#dispatcher) and settlement | `application.ts`: `connectTarget`; `handlers/integration.ts`: `onOutcome`, `settleDelivery` | `test/application.test.ts`: "the CRM refuses to let a caller follow…" |
| [Inbound sync](../../docs/primitives.md#inbound-sync) of followed accounts | `handlers/integration.ts`: `applyBatch`; `fake-crm.ts`: `pull` | `test/application.test.ts`: "adopting follows the account in the CRM; the feed fills it in and keeps it current" |
| Integration principal lane | `policy.ts`: `targetLane`, `targetRules` | `test/application.test.ts`: "people outside the workspace and the integration principal cannot search" |
| [Collection](../../docs/primitives.md#collection) list scoped by region | `handlers/accounts.ts`: `collectionListHandler` with `visible` | `test/application.test.ts`: "when the CRM is unreachable…" reads the list offline; no test covers its region scope |
| [Journal and live query](../../docs/primitives.md#journal-and-live-query) with region-scoped events | `ui/local-status.tsx`, `ui/sync-badge.tsx`; `policy.ts`: `events` | `e2e/search.pw.ts`: first test, where a result moves from adopting to adopted without a new search |
| [Requirement declaration](../../docs/primitives.md#requirement-declaration) with `targets` and `reads` | `contracts.ts`: destination `crm-api` | `packages/contracts/test/data-provider.test.ts`: "remote reads fail closed without a destination…" |
| [Module](../../docs/primitives.md#module) workflows for agents | `contracts.ts`: `find-and-log`, `review-sync` | No test in this example |
| [Surface adapter](../../docs/primitives.md#surface-adapter) conformance | Catalog built from `manifest.ts` | `test/conformance.test.ts` |
| [Capability binding](../../docs/primitives.md#capability-binding) | `ui/search.tsx`, `ui/local-status.tsx`, `ui/account/activity-form.tsx` | `e2e/search.pw.ts`; `test/ui-bindings.test.ts` |
| [Host plugin](../../docs/primitives.md#host-plugin) composition | `manifest.ts` and `application.ts`: site, network, audit, compliance; `screens.tsx`: compliance screens | `test/application.test.ts` opens the composed application; `test/ui-bindings.test.ts` includes the Compliance screen |
| [UI session context](../../docs/primitives.md#ui-session-context) selection | `application.ts`: `selectableResources.account` | No test in this example |

## Structure

| Path | Holds |
| --- | --- |
| `manifest.ts` | Browser-safe manifest: the module and the manifests of the four plugins |
| `contracts.ts` | The module: provider and local capabilities, the `crm-api` destination and the agent workflows |
| `contracts/schemas.ts` | Schemas for found items, local status, search input, accounts, activities and feed snapshots |
| `contracts/providers.ts` | The account and contact data providers |
| `contracts/target.ts` | The CRM target with its feed item and status counts |
| `contracts/operations.ts` | Account list and get, adopt, activity log, and the target's settle, sync and status |
| `contracts/collections.ts` | The account and activity collections |
| `domain.ts` | State shape, members with their sales regions, and the region visibility helpers |
| `policy.ts` | Membership, region and resource-grant rules, change events, and the integration principal's lane |
| `handlers/` | Provider mappers, local reads, adopt and log commands, and target handlers |
| `server.ts` | Concatenates the handler groups |
| `application.ts` | The application definition, the remote source, the target connection and the demo variables |
| `fake-crm.ts`, `fake-crm/` | The in-memory CRM, its seed records with CRM field names, and its paging |
| `screens.tsx`, `ui/` | Search, followed accounts, one account with its activities, and the sync badge |
| `test/`, `e2e/` | Embedded-instance tests, the cross-surface test, the UI-binding test and the Playwright spec |

## Search flow

1. The search screen debounces the input by 250 ms, keeps the previous result on screen while the next one loads, aborts the superseded request down to the source on every keystroke, and calls `crm.account.search` or `crm.contact.search` through `live.remoteInfiniteQueryOptions` (`ui/search.tsx`). MCP, the CLI and HTTP call the same queries.
2. The runtime authorizes the query in a read snapshot and builds the source request from the input (`packages/runtime/src/application/remote-queries.ts`). Policy admits members to the provider queries and limits the integration principal to its lane (`policy.ts`).
3. Outside any transaction, the runtime calls the `crm` source with the caller's context. The caller's cancellation or a 10-second deadline aborts the call.
4. The remote source uses the principal's own CRM login, else a service credential, because both providers declare `caller-or-service` (`packages/integration/src/remote-source.ts`). A delegated agent's context carries the principal of the person who delegated it.
5. The fake CRM keeps what that credential may see: owned or public accounts for a login, all accounts for a service credential (`fake-crm.ts`). It returns five matches per page by default, and its `next` cursor names the query, the search text and the CRM identity behind the credential (`fake-crm/cursor.ts`).
6. In a fresh snapshot, the runtime authorizes again and runs the item mapper (`handlers/providers.ts`). The mapper drops malformed records and records outside the caller's regions and sets `local`, and the runtime then projects, validates and authorizes once more.
7. The result holds `items`, `next` and a `source` status with the target, the time of the answer and the identity, and nothing is stored. `ui/search/source-line.tsx` shows where and when the result came from and which identity answered. The audit record keeps the target, status, identity, item count and whether more pages exist (`packages/runtime/src/application/queries.ts`).
8. "Show more from the CRM" sends the last page's `next` back as `cursor` (`ui/search/more-results.tsx`), and an agent pages the same way by passing `cursor` to the next tool call. A cursor replayed under another credential or for another search text fails with `INVALID_INPUT`.
9. When the CRM throws `DeliveryFailure`, the result is empty, with `source.status` set to `unavailable` and the CRM's message. The screen shows an alert and lists the followed accounts whose name matches, or whose CRM ID matches while they have no details (`ui/search.tsx`).

## Adoption and activity flow

Adopting is a domain command, because what adoption means depends on the domain, and the data provider does not generate it. Record content always comes from the [integration principal](../../docs/glossary.md#integration-principal). The caller cannot supply it, and an `EffectOutcome` never has to carry a record.

1. `crm.account.adopt` returns the stored status without a new effect when the account is already following or adopted (`handlers/capture.ts`). Otherwise it enqueues an `account.follow` effect on `account:<id>` and stores the account as `following`.
2. Any member may adopt any CRM ID, and a delegated caller whose grant lists resources must name `account:<id>` (`policy.ts`). The CRM decides visibility when it receives the follow request.
3. The dispatcher that `connectTarget` builds in `application.ts` claims the effect and calls `deliver` on the fake CRM. The fake checks the committing principal's CRM login, or the view of a service credential without one, and answers `accepted` or `NOT_VISIBLE`.
4. The dispatcher submits `crm.effect.settle` as the integration principal, and `targetHandlers` checks that the effect belongs to the `crm` target. A refusal marks the account `rejected` with the CRM's reason, and an acceptance leaves it `following` (`handlers/integration.ts`).
5. Inbound sync calls `pull` once a second, an interval the example sets in `application.ts` in place of the framework's five seconds. It submits `crm.account.sync` with the batch bound to the stored watermark, and a batch whose `from` is not the stored watermark conflicts.
6. `applyBatch` copies the details of each followed account and sets it `adopted`, and it skips unknown and refused accounts. A later change in the CRM, such as `rename` in the tests, reaches the account on the next pass.
7. `crm.activity.log` refuses an account that is not `adopted` with `CONFLICT`, and an `occurredAt` more than five minutes ahead or seven days old with `INVALID_INPUT`. It then enqueues `activity.create` and stores the activity with `sync: 'pending'`.
8. The fake CRM accepts an activity only for a followed account and returns the same reference for a repeated effect ID. `settleDelivery` records `sync`, `sorRef` or `rejection` on the activity.
9. Screens follow these changes through live queries, and policy admits account and activity change events only for accounts the caller may see (`policy.ts`). The followed-account list overlays each search result's status, and the sidebar badge reads `crm.sync.status` (`ui/local-status.tsx`, `ui/sync-badge.tsx`).

## Implementation steps

1. Run the example from its directory to see both flows.

   ```sh
   cd examples/crm-capture
   bun run dev:web
   DEMO_CRM_LOGIN=none bun run dev:web
   DEMO_CRM_LATENCY_MS=800 bun run dev:web
   DEMO_CRM_UNAVAILABLE=1 bun run dev:web
   ```

2. Create the application with a collection for the adopted record type, as the [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md) describes. `bun run scaffold <absent-target-directory> --name <app-name> --example crm-capture` exports this example instead.

   ```sh
   bun run scaffold new /absolute/path/to/my-capture --name my-capture --collection account
   ```

3. Install the dependencies in the new checkout.

   ```sh
   cd /absolute/path/to/my-capture
   bun install --frozen-lockfile
   ```

4. Generate the target and the activity collection, then format and regenerate the reference, as the [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md) describes. With step 2, the commands produce the parts listed below.

   ```sh
   bun run scaffold add target crm --collection account
   bun run scaffold add collection activity
   bun run format
   bun run generate
   ```

   - **Collections**: `account` and `activity`, each with list, read-one, create and update operations, a handler file, default screens and a test.
   - **Target files**: `contracts/crm-target.ts`, `handlers/crm-target.ts`, `crm-port.ts` with a `FakeCrm` port, `ui/crm-target.tsx` and `test/crm-target.test.ts`.
   - **Target operations**: `crm.effect.settle`, `crm.sync` and `crm.sync.status`, the default IDs.
   - **Send command**: `crm.send`, with an `editor` policy rule and a `crmDeliveries` map in `domain.ts`.
   - **Integration principal**: a policy lane for `crm-integration`, the target's rules and a `connectTarget` call inside `connect`.
   - **Destination**: `crm-api` with `targets`, `dataClasses`, scope `site` and availability `required`, listed as disabled in `apps/desktop/site-policy.json`.
   - **Screens**: a `crm` route, a `/crm` navigation entry and a `crm.` capability-screen prefix for a status screen with a send form.

5. Reshape the account record in `contracts/account.ts` to what adoption stores. `examples/crm-capture/contracts/schemas.ts` and `domain.ts` are the reference.
   - **Key**: the CRM ID in place of a generated key.
   - **Status**: `following`, `adopted` and `rejected` in place of `open` and `done`.
   - **Fields**: the CRM details as optional fields, the adopting principal, the rejection and a count of the account's activities.
   - **Stored type**: a type in `domain.ts` that adds the effect ID, which callers never see.
   - **List**: the `id` option set to `crm.account`, which names the list `crm.account.list`, with a status filter and no `search`.
6. Change the list handler in `handlers/account.ts`: `order` by adoption time, no `searchText`, and a `present` option that strips the effect ID and adds the activity count. `examples/crm-capture/handlers/accounts.ts` and `accountDto` in `handlers/context.ts` are the reference.
7. Replace the generated `collectionGet` and its handler with a `crm.account.get` query that returns the account and its activities as `history`. `examples/crm-capture/contracts/operations.ts` and `handlers/accounts.ts` are the reference.
8. Delete the generated `account.create` and `account.update` commands with their rules, handlers and `test/account.test.ts`, so a local account can only come from adoption.
9. Replace the default account screens in `ui/account.tsx` with a followed-account list and an account screen that shows the history from `crm.account.get`. The [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md) covers screens, and `examples/crm-capture/ui/accounts.tsx` and `ui/account.tsx` are the reference.
10. Reshape the activity record in `contracts/activity.ts` to what the log command stores. `examples/crm-capture/contracts/schemas.ts` and `domain.ts` are the reference.
    - **Content**: the account ID, the kind, the summary and `occurredAt`.
    - **Delivery**: the delivery fields `sync`, `sorRef` and `rejection`.
    - **Stored type**: a type in `domain.ts` that adds the effect ID, which callers never see.
11. Remove the four generated activity operations, keeping the collection itself for `records`. Each has a UI binding that the generated UI-binding test checks, and the example reads activity records only through `crm.account.get`.
    - **Contract**: `activity.list`, `activity.get`, `activity.create` and `activity.update` in `contracts/activity.ts`.
    - **Policy and handlers**: their rules in `policy.ts` and their handlers in `handlers/activity.ts`.
    - **Screens and test**: `ui/activity.tsx`, `test/activity.test.ts`, and the activity route, navigation entry and prefix in `screens.tsx`.
12. Add a `crm.activity.log` command that declares `integration: { target: 'crm', delivery: 'outbox' }`, as the [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md) describes. Its handler refuses an account that is not adopted, enqueues an effect of type `activity.create` and stores the activity as pending (`examples/crm-capture/handlers/capture.ts`).
13. Give `crm.account.get` and the log command a rule with `grant` and `allow`, as the `onAccount` rule in `examples/crm-capture/policy.ts` does.
14. Edit the target declaration in `contracts/crm-target.ts`: `settles` lists `account` and `activity`, the feed item is the CRM's account snapshot, and `status` names your counts. Set `operations` for IDs other than the defaults, as the example does to name its sync `crm.account.sync` (`examples/crm-capture/contracts/target.ts`).
15. Edit the `crm-api` destination in `contracts.ts`, with `examples/crm-capture/contracts.ts` as the reference:
    - **Reads**: `reads: ['crm']` beside `targets`, without which the catalog refuses a remote query on the target.
    - **Data classes**: the classes that cross the destination, which the data-flow manifest reports.
    - **Scope and availability**: `internet` and `optional` in the example.
16. Replace the generated `crm.send` command with a `crm.account.adopt` command that declares `integration: { target: 'crm', delivery: 'outbox' }`. Its handler enqueues a follow effect and stores the account as following (`examples/crm-capture/handlers/capture.ts`).
    - **Contract**: the `crmSend` entry in `contracts/crm-target.ts` and in the operations of `contracts.ts`.
    - **Policy**: its `editor` rule in `policy.ts`.
    - **Handler**: the send handler in `handlers/crm-target.ts` and the `crmDeliveries` map in `domain.ts`.
    - **Screen**: the send form in `ui/crm-target.tsx`.
17. Give the adopt command a rule with only `grant`, and keep the inserted lane and target rules. The example admits every member to adopt, and the CRM decides visibility on delivery (`examples/crm-capture/policy.ts`).
18. Rewrite the three domain parts of `targetHandlers` in `handlers/crm-target.ts`, with `examples/crm-capture/handlers/integration.ts` as the reference:
    - **`onOutcome`**: a refused follow marks the account `rejected`, and `settleDelivery` records the outcome on an activity.
    - **`applyBatch`**: a feed item turns a followed account into an adopted one, and unknown or refused accounts are skipped.
    - **`status`**: counts by account status within the caller's scope, and `pending` from `ctx.effects`.
19. Delete the status screen in `ui/crm-target.tsx`, and remove its `crm` route and `/crm` navigation entry from `screens.tsx`, because `defineScreens` refuses a navigation entry without a route. Put a badge in the `status` slot and point the `crm.` prefix at the account screens (`examples/crm-capture/screens.tsx`, `ui/sync-badge.tsx`).
20. Replace the role per member in `domain.ts` with a scope per member, and change the caller gate in `policy.ts` and the `members` option in `application.ts` to match. The example stores sales regions per member and has no roles (`examples/crm-capture/domain.ts`).
21. Apply the scope to every local read before paging or counting:
    - **List**: the `visible` option of `collectionListHandler`.
    - **Account query**: the `crm.account.get` handler from step 7.
    - **Status**: the counts in the `status` handler.
    - **Change events**: the `account` and `activity` entries of `events` in `policy.ts`.
22. Declare each searchable record type with `defineDataProvider` in a browser-safe contracts file (`examples/crm-capture/contracts/providers.ts`). A provider declares these fields:
    - `id`: the operation prefix, such as `crm.account`.
    - `target`: the target name the source answers for.
    - `identity`: `caller`, or `caller-or-service` to allow a service credential.
    - `resourceType`: the resource type both queries require permission on.
    - `query`: the search input schema, without `cursor`.
    - `item`: the found record schema, with `externalId`.
    - `descriptions`: the search and lookup text that agents read.
    - `ui`: a binding or an `exception` per query, with an exception for a lookup that no screen calls.
23. Spread each provider's `capabilities` into the module in `contracts.ts`.
24. Add the provider queries to the policy as `'open'`.
25. Implement each provider with `implementDataProvider(provider, { item })` in a handler group that `server.ts` concatenates. The mapper parses the record, returns `undefined` for a malformed record or one outside the caller's scope, and adds the local status (`examples/crm-capture/handlers/providers.ts`).
26. Rewrite the generated `FakeCrm` in `crm-port.ts` for tests, with `examples/crm-capture/fake-crm.ts` and `fake-crm/cursor.ts` as the reference:
    - **`deliver`**: checks the committing principal's access, tracks follows, and accepts an activity only for a followed account.
    - **`pull`**: feeds snapshots of followed accounts.
    - **`search` and `credentials`**: answer per credential, with a cursor bound to the search and the credential.
    - **Types**: `CrmItem` becomes the snapshot type, and the port implements `SystemOfRecordPort<Item, Credential>`.
27. Write the production connector as a class that implements `SystemOfRecordPort<Item, Credential>` with `describe`, `deliver`, `pull` and `search`. Add `lookup` when the CRM cannot deduplicate by effect ID.
28. Make the connector report failures in the framework's terms:
    - **Business refusal**: return `{ status: 'rejected', code, message }`.
    - **Unreachable CRM**: throw `DeliveryFailure` with a message that is safe to show.
    - **Foreign cursor**: throw `ApplicationError` with `INVALID_INPUT`.
29. Implement `CallerCredentials` over the deployment's credential store: `forPrincipal` returns the principal's own CRM credential, and `service` the technical one. Never read a credential from input.
30. Move the generated port out of `connect` into the application factory, type its option with the credential, and add an option that supplies the `CallerCredentials`. The generated factory builds the port inside `connect` and has no credentials option.
31. Pass the same port instance to the `connectTarget` call and to `sources: { crm: createRemoteSource({ target: 'crm', port, credentials }) }`. `examples/crm-capture/application.ts` is the reference.
32. Wrap the integration's `start` to pass `syncMs` if the default feed interval of five seconds is too slow. The example passes one second, so an adopted account fills in shortly after the CRM accepts the follow.
33. Add `selectableResources: { account: 'crm.account.get' }` to the application definition, so an agent run can capture the account a person has open. The host checks each selection through that query with the caller's own grants and policy.
34. Add `workflows` to the module in `contracts.ts` that tell agents which operations to chain and how. `find-and-log` and `review-sync` in `examples/crm-capture/contracts.ts` are the reference.
35. Build the search screen with `live.remoteInfiniteQueryOptions` over debounced input, and fall back to the followed-account list when `source.status` is `unavailable` (`examples/crm-capture/ui/search.tsx`).
36. Register the search screen in `screens.tsx` with a `search` route as home and a navigation entry. Add prefixes for the provider queries and the adopt command, which win over `crm.` because the longest prefix wins (`examples/crm-capture/screens.tsx`).
37. Overlay each result's local status from `live.liveQueryOptions` over the account list (`examples/crm-capture/ui/local-status.tsx`).
38. Build the activity form with `useCapabilityForm` (`examples/crm-capture/ui/account/activity-form.tsx`).
39. Replace `test/crm-target.test.ts` with behavioral tests on `openEmbeddedInstance`, with one delivery pass and one feed pass through `integrations.target('crm').dispatcher.runOnce()` and `integrations.sync()`. Cover these cases, as `examples/crm-capture/test/application.test.ts` does:
    - **Sharing**: the caller's own CRM access.
    - **Fallback**: a service credential limited to the member's scope.
    - **Cursors**: a cursor refused under another credential or search.
    - **Refusal**: the CRM refusing a follow.
    - **Outage**: an unreachable CRM with local work continuing.
    - **Delegation**: an agent searching as its delegator within its grant.
    - **Refused callers**: outsiders and the integration principal.
40. Replace the account-list comparison in the generated `test/conformance.test.ts` with one search compared over the runtime, HTTP, the CLI and MCP. The generated comparison calls `account.create`, which step 8 removes (`examples/crm-capture/test/conformance.test.ts`).
41. Replace the generated browser test `e2e/default-screens.pw.ts` with a spec for the search and account screens (`examples/crm-capture/e2e/search.pw.ts`). The generated UI-binding test scans the whole application directory, so it covers the new screens unchanged.
42. Rewrite the generated `README.md` for the new application.
43. Bind `crm-api` to the CRM's URL in the deployment policy, as the [deploy-to-site skill](../../plugins/site/skills/deploy-to-site/SKILL.md) describes.
44. Run the focused checks, then the full check, as the [check-a-change skill](../../packages/testing/skills/check-a-change/SKILL.md) describes.

    ```sh
    bun test examples/my-capture
    bunx playwright test examples/my-capture/e2e
    bun run test:integration
    bun run check
    ```

## Limits

- **Fake CRM.** The CRM is in memory and per process, and no real CRM has run against the example ([implementation status](../../docs/implementation-status.md)).
- **Restart.** The fake forgets its follows and activities when the host stops, while the workspace still holds those accounts as adopted. The fake then refuses their new activities with `NOT_FOLLOWED`, and the feed never delivers them again.
- **No network path.** The fake CRM makes no network call, so no CRM traffic crosses the declared `crm-api` destination or the egress guard.
- **Remote source outside `connect`.** The source is built with the application definition, so it does not receive the network port that `connect` gets. Neither example with a data provider reaches its source through the network port.
- **Demo credentials.** Credentials are strings held in the fake, and only the owner can be given a login through `DEMO_CRM_LOGIN`.
- **Unsigned cursors.** The fake encodes the cursor's binding as readable JSON. The fake's comment says a real target keeps the binding on its own side.
- **Short pages.** Region scoping in the item mapper can return a short or empty page while `next` still points further. With a service credential it is the only filter.
- **Connector conformance.** The fake CRM is not run through `connectorConformance`, and that suite has no search case.
- **Held effects.** The example composes no reconciliation operations, so no command in it can settle or release an effect the dispatcher holds.
- **No unfollow or edit.** No command stops following an account or changes a logged activity. A followed account stays in the feed for the life of the fake.
- **Accounts without a region.** An account without details has no region, so every member sees it (`domain.ts`). A followed account gets its region when the feed delivers it, and a refused account never gets one.
- **State migrations.** The example declares none, so a change to the stored record shape needs a migration the example does not show. The [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md) covers state migrations.

## Related pages

- [System-of-record pattern](../../docs/systems-of-record.md#remote-queries)
- [Primitives](../../docs/primitives.md)
- [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md)
- [Quality inspection](../quality-inspection/README.md), the outbox and feed without remote queries
- [Asset survey](../asset-survey/README.md), a second data provider over an EAM
- [Receiving](../receiving/README.md), held effects and reconciliation

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers data providers, the target and adoption.
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md) and [build-screens](../../packages/frame/skills/build-screens/SKILL.md) cover the local capabilities and the screens.
