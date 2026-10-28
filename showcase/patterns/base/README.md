# Oil lab test requests

A technician submits a request to test an oil sample from a transformer. Another technician assigns a method, such as dissolved gas analysis; viewers can read the requests. This small application is the starting point for the other [patterns](../../../docs/patterns.md), which add one concern without changing the base module, handlers, policy or screens.

## Try the desk

From the repository root:

```sh
cd showcase/patterns/base
bun run dev:web
```

Create a request with a sample, transformer and description. Open the request and assign a method. The list and record screens use the same reads and commands available through the CLI and MCP.

## What the code does

[`contracts.ts`](contracts.ts) declares the test-request [collection](../../../docs/primitives.md#collection), list and get queries, and submit and update commands. [`handlers.ts`](handlers.ts) applies those commands to the `testRequests` slice. [`policy.ts`](policy.ts) allows only members through the caller gate: technicians submit and update, while viewers read. An update with an old expected revision fails with `CONFLICT`.

[`screens.tsx`](screens.tsx) binds the list and record screens; `ui/requests.tsx` lets an extension add sections to the request screen. The catalog also exposes `test-requests.assign-method` as an MCP workflow resource. `bun run generate` writes the reference to `dist/reference/test-requests/`.

## Checks

```sh
bun test showcase/patterns/base
```

`test/requests.test.ts` covers roles, revision conflicts and idempotent retries. `test/headless.test.ts` submits and lists requests through the CLI and MCP.
