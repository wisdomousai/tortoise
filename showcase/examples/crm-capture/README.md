# CRM field capture

A field salesperson searches accounts and contacts in a CRM, follows an account to keep a local copy and records activities against it. The CRM stays authoritative: search is a live read the app does not store, and followed accounts stay available through a CRM outage. [`fake-crm.ts`](fake-crm.ts) stands in, with Salesforce-style fields to show the mapping; nothing connects to Salesforce.

```sh
cd showcase/examples/crm-capture
bun run dev:web
```

## What to try

- Search for an account as `ann` (port 4324), follow it, and add an activity once it shows **following**.
- `DEMO_CRM_LOGIN=ben` signs in as Ben; `DEMO_CRM_LOGIN=none` uses the service-account fallback.
- `DEMO_CRM_LATENCY_MS=800` shows the loading state.
- `DEMO_CRM_UNAVAILABLE=1` takes live search away while the local list keeps working.

## References

- Primitives: [remote query](../../../docs/primitives.md#remote-query)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md)
- `bun test showcase/examples/crm-capture`, `bunx playwright test showcase/examples/crm-capture/e2e`
