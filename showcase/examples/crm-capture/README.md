# CRM field capture

A field salesperson searches accounts and contacts in a CRM, then follows an account to keep a local copy and record activities. The CRM remains authoritative for its records. Search is a live read and is not stored; followed accounts remain available locally if the CRM goes down.

The development CRM is [`fake-crm.ts`](fake-crm.ts). The example uses Salesforce-style fields to illustrate mapping, but does not connect to Salesforce.

## Try the example

From the repository root:

```sh
cd showcase/examples/crm-capture
bun run dev:web
```

The browser host uses port 4324 and signs the owner into the fake CRM as `ann`. Search for an account, follow it, then add an activity once the account is marked **following**. `bun run dev` opens the desktop window.

Change the fake CRM's behavior on launch:

- `DEMO_CRM_LOGIN=ben` uses Ben's login; `DEMO_CRM_LOGIN=none` uses the service-account fallback.
- `DEMO_CRM_LATENCY_MS=800` makes the loading state visible.
- `DEMO_CRM_UNAVAILABLE=1` makes live search unavailable while the local list remains usable.

## Search, follow and capture

The search screen waits 250 ms after typing and cancels superseded requests. The [remote query](../../../docs/primitives.md#remote-query) runs outside a local transaction using the caller's CRM login, or a service account when that caller has none. The CRM applies its sharing rules; the application then filters results to the caller's regions and checks access again. The screen shows which identity provided the results. A page cursor belongs to its search and CRM identity, so it cannot be reused for another search or login.

Following an account is different from searching. The follow command records a requested status and queues an effect. The CRM may reject the request; on acceptance, inbound sync imports account details and changes the status to following. Logging an activity against that account commits the activity and another effect locally, then records the CRM's acceptance or rejection when delivery completes.

The search and follow screens are in [`ui/search.tsx`](ui/search.tsx); the live sources are declared in [`contracts/providers.ts`](contracts/providers.ts). [`handlers/capture.ts`](handlers/capture.ts) records follow requests and activities, and [`handlers/integration.ts`](handlers/integration.ts) applies outcomes and feed updates.

## Trust boundary

Members of the workspace may search, follow and log activities, scoped to their regions. The integration principal (`INTEGRATION_PRINCIPAL`) may only sync accounts, complete effects and read the sync status. It cannot search, so a delivery worker can never read the CRM with a person's credential.

A delegated agent's context principal is its delegator. The agent searches with that person's CRM access, within the capabilities its [grant](../../../docs/glossary.md#grant) names.

Both providers declare `caller-or-service`. A caller with a CRM login searches with it, and the CRM applies its own sharing rules. Ann sees her accounts and public ones, and does not see Ben's private ones. The service account serves a caller without a login, and only rows in the member's regions survive the item mapper. The source line on screen says which identity the search ran as.

Policy projection runs on the result in both cases. The runtime authorizes again after the CRM responds, so a revocation during the call drops the result.

Page cursors are bound to the search text and the CRM login that produced them. The owner's login cannot continue a page the service account fetched, and no cursor applies to another search. The CRM refuses both with `INVALID_INPUT`. Region scoping runs on every page. A service-account page can therefore come back short or empty while `next` still points further.

Search input goes to the CRM. Results go to the caller and are never stored or journaled. The [audit log](../../../docs/glossary.md#audit-log) records the target, status, identity and item count, and leaves out the query and the rows. CRM error text does not reach the caller, except an `UNAVAILABLE` message the source marked as safe.

In the fake CRM, credentials are demo strings held in memory. A deploying application backs `CallerCredentials` with its [credential vault](../../../docs/glossary.md#credential-vault) and never reads keys from input.

## Limits

- **Fake CRM.** The CRM is in memory and per process, and no real CRM has run against the example ([implementation status](../../../docs/implementation-status.md)).
- **Restart.** The fake forgets its follows and activities when the host stops, while the workspace still holds those accounts as followed. The fake then refuses their new activities with `NOT_FOLLOWED`, and the feed never delivers them again.
- **No network path.** The fake CRM makes no network call, so no CRM traffic crosses the declared `crm-api` destination or the egress guard.
- **Remote source outside `connect`.** The source is built with the application definition, so it does not receive the network port that `connect` gets. Neither example with a data provider reaches its source through the network port.
- **Demo credentials.** Credentials are strings held in the fake, and only the owner can be given a login through `DEMO_CRM_LOGIN`.
- **Unsigned cursors.** The fake encodes the cursor's binding as readable JSON. The fake's comment says a real target keeps the binding on its own side.
- **Short pages.** Region scoping in the item mapper can return a short or empty page while `next` still points further. With a service credential it is the only filter.
- **Connector conformance.** The fake CRM is not run through `connectorConformance`, and that suite has no search case.
- **Held effects.** The example composes no reconciliation operations, so no command in it can complete or release an effect the dispatcher holds.
- **No unfollow or edit.** No command stops following an account or changes a logged activity. A followed account stays in the feed for the life of the fake.
- **Accounts without a region.** An account without details has no region, so every member sees it (`domain.ts`). A followed account gets its region when the feed delivers it, and a refused account never gets one.
- **State migrations.** The example declares none, so a change to the stored record shape needs a migration the example does not show.

## Checks

From the repository root:

```sh
bun test showcase/examples/crm-capture
bunx playwright test showcase/examples/crm-capture/e2e
```

`test/application.test.ts` covers CRM sharing, regional filtering, follow and outage behavior. `test/conformance.test.ts` compares the remote query across direct, HTTP, CLI and MCP calls. The browser tests use the fake CRM; a real CRM requires an explicitly configured connector and account.
