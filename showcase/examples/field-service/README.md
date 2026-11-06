# Field service work orders

This hypothetical field-service application keeps work orders for customer sites. Membership scopes access to a work order, and the dispatcher role can read its internal note. Other members cannot read that field or use it for search and sorting.

The starter selects this application by default. Its task-generation route uses a deterministic harness unless a provider is explicitly configured. The webhook destination represents a simulated customer-portal integration.

```sh
cd showcase/examples/field-service
bun run dev:web
```

## What to try

Create a work order and a task (port 4321), then choose **Create tasks from instructions**: the offline harness turns each line into a task command without a provider account.

With the host running, set `TORTOISE_CONNECTION` to its connection file and run `bun run job <work-order-id>` from this directory to move up to 100 todo tasks to doing.

`bun run dev` opens the same app in a desktop window.

## References

Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#os-integration)

`bun test showcase/examples/field-service`, `bunx playwright test showcase/examples/field-service/e2e`
