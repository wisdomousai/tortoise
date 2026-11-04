# Field service work orders

A dispatcher opens a work order for a customer site and adds technicians and customers as members. The team records tasks, attaches photos or PDFs and updates progress. Only the dispatcher reads the internal note; other members cannot read, search or sort by it. The starter runs this example by default, and a webhook stands in for a customer portal.

```sh
cd showcase/examples/field-service
bun run dev:web
```

## What to try

- Create a work order and a task (port 4321), then choose **Create tasks from instructions**: the offline harness turns each line into a task command without a provider account.
- With the host running, set `TORTOISE_CONNECTION` to its connection file and run `bun run job <work-order-id>` from this directory to move up to 100 todo tasks to doing.
- `bun run dev` opens the same app in a desktop window.

## References

- Primitives: [live query](../../../docs/primitives.md#journal-and-live-query), [credential vault](../../../docs/primitives.md#credential-vault)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#os-integration)
- `bun test showcase/examples/field-service`, `bunx playwright test showcase/examples/field-service/e2e`
