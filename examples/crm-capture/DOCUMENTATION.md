# CRM capture

The CRM capture example searches a CRM at the moment someone asks, with that caller's own CRM access, and stores none of the results. A person or an agent adopts an account they found, and the CRM's feed then brings the account into the workspace and keeps it current. Calls, meetings and notes logged against an adopted account travel to the CRM through the outbox. This page is for someone building a similar application by hand or with a coding agent. The [CRM capture README](README.md) describes the entrypoints, the trust boundary and the test table.

## Demonstrated mechanisms

Paths in this section are relative to the example directory unless they start with `packages/`. Test names are quoted from the test files.

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
| `test/`, `e2e/` | Embedded-authority tests, the cross-surface test, the UI-binding test and the Playwright spec |

## Search flow

1. The search screen debounces the input by 250 ms and calls `crm.account.search` or `crm.contact.search` through `live.remoteInfiniteQueryOptions` (`ui/search.tsx`). MCP, the CLI and HTTP call the same queries.
2. The runtime authorizes the query in a read snapshot and builds the source request from the input (`packages/runtime/src/application/remote-queries.ts`). Policy admits members to the provider queries and limits the integration principal to its lane (`policy.ts`).
3. Outside any transaction, the runtime calls the `crm` source with the caller's context. The caller's cancellation or a 10-second deadline aborts the call.
4. The remote source uses the principal's own CRM login, else a service credential, because both providers declare `caller-or-service` (`packages/integration/src/remote-source.ts`). A delegated agent's context carries the principal of the person who delegated it.
5. The fake CRM keeps what that credential may see: owned or public accounts for a login, all accounts for a service credential (`fake-crm.ts`). It returns five matches per page by default, and its `next` cursor names the query, the search text and the CRM identity behind the credential (`fake-crm/cursor.ts`).
6. In a fresh snapshot, the runtime authorizes again and runs the item mapper (`handlers/providers.ts`). The mapper drops malformed records and records outside the caller's regions and sets `local`, and the runtime then projects, validates and authorizes once more.
7. The result holds `items`, `next` and a `source` status with the target, the time of the answer and the identity, and nothing is stored. The audit record keeps the target, status, identity, item count and whether more pages exist (`packages/runtime/src/application/queries.ts`).
8. "Show more from the CRM" sends the last page's `next` back as `cursor` (`ui/search/more-results.tsx`). A cursor replayed under another credential or for another search text fails with `INVALID_INPUT`.
9. When the CRM throws `DeliveryFailure`, the result is empty, with `source.status` set to `unavailable` and the CRM's message. The screen shows an alert and lists the followed accounts whose name matches, or whose CRM ID matches while they have no details (`ui/search.tsx`).

## Adoption and activity flow

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

1. Run the example from its directory to see both flows. The demo variables select the owner's CRM login, slow searches and make the CRM unreachable.

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
33. Add `selectableResources: { account: 'crm.account.get' }` to the application definition, so an agent run can capture the account a person has open. The host checks each selection through that query under the caller's own authority.
34. Add `workflows` to the module in `contracts.ts` that tell agents which operations to chain and how. `find-and-log` and `review-sync` in `examples/crm-capture/contracts.ts` are the reference.
35. Build the search screen with `live.remoteInfiniteQueryOptions` over debounced input, and fall back to the followed-account list when `source.status` is `unavailable` (`examples/crm-capture/ui/search.tsx`).
36. Register the search screen in `screens.tsx` with a `search` route as home and a navigation entry. Add prefixes for the provider queries and the adopt command, which win over `crm.` because the longest prefix wins (`examples/crm-capture/screens.tsx`).
37. Overlay each result's local status from `live.liveQueryOptions` over the account list (`examples/crm-capture/ui/local-status.tsx`).
38. Build the activity form with `useCapabilityForm` (`examples/crm-capture/ui/account/activity-form.tsx`).
39. Replace `test/crm-target.test.ts` with behavioral tests on `openEmbeddedAuthority`, with one delivery pass and one feed pass through `integrations.target('crm').dispatcher.runOnce()` and `integrations.sync()`. Cover these cases, as `examples/crm-capture/test/application.test.ts` does:
    - **Sharing**: the caller's own CRM access.
    - **Fallback**: a service credential limited to the member's scope.
    - **Cursors**: a cursor refused under another credential or search.
    - **Refusal**: the CRM refusing a follow.
    - **Outage**: an unreachable CRM with local work continuing.
    - **Delegation**: an agent searching as its delegator within its grant.
    - **Refused callers**: outsiders and the integration principal.
40. Replace the account-list comparison in the generated `test/conformance.test.ts` with one search compared over the runtime, HTTP, the CLI and MCP. The generated comparison calls `account.create`, which step 8 removes (`examples/crm-capture/test/conformance.test.ts`).
41. Replace the generated browser test `e2e/default-screens.pw.ts` with a spec for the search and account screens (`examples/crm-capture/e2e/search.pw.ts`). The generated UI-binding test scans the whole application directory, so it covers the new screens unchanged.
42. Update the application's `README.md`: the trust boundary, the entrypoints and the tests. The generated text describes editors and viewers and the default-screens browser test.
43. Bind `crm-api` to the CRM's URL in the site policy, as the [deploy-to-site skill](../../plugins/site/skills/deploy-to-site/SKILL.md) describes.
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

- [CRM capture README](README.md)
- [System-of-record pattern](../../docs/system-of-record-pattern.md#live-search-and-adoption)
- [Primitives](../../docs/primitives.md)
- [connect-system-of-record skill](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md)
- [Quality inspection](../quality-inspection/DOCUMENTATION.md), the outbox and feed without remote queries
- [Asset survey](../asset-survey/DOCUMENTATION.md), a second data provider over an EAM
- [Receiving](../receiving/DOCUMENTATION.md), held effects and reconciliation
