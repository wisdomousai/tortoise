# CRM field capture

This hypothetical field-sales application searches CRM records through a remote query. Following an account starts the flow that keeps a local copy available for later activity capture. The application retains followed data when the live query is unavailable.

Development uses [fake-crm.ts](fake-crm.ts). Its Salesforce-style field mapping is fixture data; the application has no Salesforce connection.

```sh
cd showcase/examples/crm-capture
bun run dev:web
```

## What to try

Search for an account as `ann` (port 4324), follow it, and add an activity once it shows **following**.

`DEMO_CRM_LOGIN=ben` signs in as Ben; `DEMO_CRM_LOGIN=none` uses the service-account fallback.

`DEMO_CRM_LATENCY_MS=800` shows the loading state.

`DEMO_CRM_UNAVAILABLE=1` takes live search away while the local list keeps working.

## References

Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md)

`bun test showcase/examples/crm-capture`, `bunx playwright test showcase/examples/crm-capture/e2e`
