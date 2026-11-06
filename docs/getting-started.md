# Getting started

Build an application that records equipment inspections.

## New application

You need Bun and a clone of this repository.

**Install the framework.** In the framework repository:

```sh
bun install --frozen-lockfile
```

**Export a new app.** Use a path outside this repository that does not exist yet:

```sh
bun run scaffold new /tmp/inspection-desk --name inspection-desk --display-name "Inspection Desk" --collection inspection
```

You should see:

```text
Exported <count> source files for inspection-desk to /tmp/inspection-desk
Next: bun install --frozen-lockfile && bun run format && bun run generate && bun run typecheck && bun test
```

The new directory is a full copy of the framework plus your app in `showcase/examples/inspection-desk/`. `app.config.json` already points at it.

**Install and test it.**

```sh
cd /tmp/inspection-desk
git init && git add -A && git commit -qm "scaffold"
bun install --frozen-lockfile
bun run generate
bun run typecheck
bun test showcase/examples/inspection-desk
```

Generation writes the catalog-derived artifacts under `dist/reference`. Typechecking should succeed, and the generated application tests should pass. The tests exercise the initial collection and its access policy; later changes need corresponding assertions.

## Run it

**Start the app.**

```sh
bun run dev:web
```

You should see one JSON line with `"application":"inspection-desk"` and a `launchUrl` like `http://127.0.0.1:4317/#launch=...`.

**Open the `launchUrl` in a browser.** It works once, within one minute. You should see an **Inspections** table (Id, Title, Status, Created By, Created At) and a **New** form with a Title field and a **Create** button.

![The Inspections screen of the fresh export: the empty table and the New form](assets/screenshots/getting-started/05-inspections.png)

Create one inspection. The row appears in the table without a reload, and opening it shows the record with its Edit form.

![The record screen of one inspection: its fields and the Edit form](assets/screenshots/getting-started/05-inspection.png)

**Use the CLI.** In a second terminal, from `/tmp/inspection-desk`:

```sh
export TORTOISE_CONNECTION="$(pwd)/.workspace/.connection.json"
bun run cli help
bun run cli inspection list --output text
```

You should see the command list, ending in `Exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict, ...`, then a table with the inspection you created in the browser. `--output csv` prints every inspection as CSV instead. The conformance test checks that the generated collection is reachable through the supported channels.

Stop the app with Ctrl+C before you change code.

## Add a field

For this exercise, an inspection must identify the equipment being checked. The generated create and update schemas derive their fields from the collection declaration, so the field must be present there before callers can submit it.

**Add the field to the record.** In `showcase/examples/inspection-desk/contracts/inspection.ts`, add one line to `inspectionSchema`:

```ts
export const inspectionSchema = z.strictObject({
  id: recordKeySchema,
  title: z.string().min(1).max(200),
  equipmentId: z.string().min(1).max(80), // new
  status: z.enum(['open', 'done']),
  // ...
});
```

In the same file, add `'equipmentId'` to the `fields` of the create and update commands:

```ts
inspectionCreate: collectionCreate(inspections, { /* ... */ fields: ['title', 'equipmentId'] }),
inspectionUpdate: collectionUpdate(inspections, { /* ... */ fields: ['title', 'equipmentId', 'status'] }),
```

**Run the tests.**

```sh
bun test showcase/examples/inspection-desk
```

Creation inputs in the existing tests now fail with `Input does not match operation schema` because they omit the required equipment identifier. This failure checks that the schema change reached the generated command input.

**Fix the tests.** In `test/inspection.test.ts` and `test/conformance.test.ts`, add `equipmentId: 'PUMP-4'` to every `inspection.create` input. In `e2e/inspections.pw.ts`, fill the new field after the title:

```ts
await page.getByRole('textbox', { name: 'Equipment Id', exact: true }).fill('PUMP-4');
```

Add a test for the new rule at the end of `test/inspection.test.ts`:

```ts
test('an inspection without an equipment ID is refused', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(
      { operation: 'inspection.create', input: { title: 'No ID', equipmentId: '' }, idempotencyKey: 'no-id' },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
```

Run `bun test showcase/examples/inspection-desk` again. Confirm that the original behaviors still pass and that the new assertion refuses an empty equipment identifier.

The browser record created earlier has the old stored shape. Stop the host and move this exercise's workspace aside before starting the changed code:

```sh
mv /tmp/inspection-desk/.workspace /tmp/inspection-desk/.workspace-before-equipment
```

The next launch creates an empty workspace. This keeps the earlier trial records available in the renamed directory. A deployed application that must preserve its records needs a [state migration](capability-authoring.md#snapshots-and-storage) for a newly required field.

**Try it from the CLI.** Start `bun run dev:web` again, then in the second terminal:

```sh
bun run cli help inspection create
bun run cli inspection create --title "Check pump 4" --equipment-id PUMP-4 --key inspection-pump-4
bun run cli inspection create --title "No equipment" --equipment-id "" --key bad-1; echo "exit $?"
```

You should see:

```text
inspection-desk inspection create --equipment-id <string> --title <string> [--key <idempotency-key>]
{"operation":"inspection.create","result":{"id":"97d4b14c-...","title":"Check pump 4","equipmentId":"PUMP-4","status":"open",...},...}
{"error":{"code":"INVALID_INPUT","message":"Input does not match operation schema"}}
exit 2
```

The browser form now has an **Equipment Id** field too. `--key` is an idempotency key: run the same create twice with the same key and you get one inspection.

## Add a command

**Generate the command.** Stop the app, then:

```sh
bun run scaffold add capability inspection.close --kind command --description "Mark an open inspection done. Editors only."
```

You should see `Wrote 6 files in showcase/examples/inspection-desk`. It created `contracts/inspection-close.ts`, `handlers/inspection-close.ts` and `test/inspection-close.test.ts`, and registered them in `contracts.ts`, `policy.ts` (editors only) and `server.ts`. The generated command takes `{}` and does nothing yet.

**Write the contract.** Replace `contracts/inspection-close.ts`:

```ts
import { z } from 'zod';
import { defineCapability, jsonSchema, recordKeySchema } from '@tortoise/contracts';
import { inspectionSchema } from './inspection';

export const inspectionClose = defineCapability({
  id: 'inspection.close',
  kind: 'command',
  description: 'Mark an open inspection done. Editors only.',
  input: jsonSchema(z.strictObject({ id: recordKeySchema })),
  output: jsonSchema(inspectionSchema),
  permission: { action: 'write', resourceType: 'Inspection' },
  ui: { exception: 'headless until a screen binds it' },
});
```

**Write the handler.** Replace `handlers/inspection-close.ts`:

```ts
import { ApplicationError } from '@tortoise/contracts';
import { own, type HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';

export function inspectionCloseHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.inspectionClose, (input, ctx) => {
      const inspection = own(ctx.state.inspections, input.id);
      if (!inspection) throw new ApplicationError('NOT_FOUND', 'No such inspection');
      if (inspection.retired)
        throw new ApplicationError('CONFLICT', 'Inspection is retired');
      if (inspection.status === 'done')
        throw new ApplicationError('CONFLICT', 'Inspection is already done');
      inspection.status = 'done';
      ctx.change(`inspection:${inspection.id}`);
      return inspection;
    }),
  ];
}
```

The handler performs its lookup inside the command transaction. It refuses an unavailable record and checks the current lifecycle state before changing it. `ctx.change` declares the affected resource so the commit receives a revision and journal entry. The policy generated by the scaffold still determines who may call the command.

**Write the test.** `bun test showcase/examples/inspection-desk` now fails in `inspection-close.test.ts`, because the generated test still sends `{}`. Replace its test body so it creates an inspection, then checks that a viewer gets `FORBIDDEN`, the local user gets `status: 'done'`, and a second close gets `CONFLICT`:

```ts
test('editors close an open inspection once; viewers cannot', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'inspection-desk-inspection-close-'));
  const instance = await openEmbeddedInstance(
    createInspectionDeskApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => 'i-1', now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const app = instance.application;
  const close = (key: string, who: typeof localUser) =>
    app.invokeRaw({ operation: 'inspection.close', input: { id: 'i-1' }, idempotencyKey: key }, who);

  await app.invokeRaw(
    { operation: 'inspection.create', input: { title: 'Pump 4', equipmentId: 'PUMP-4' }, idempotencyKey: 'c' },
    localUser,
  );
  await expect(close('v', viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await close('close', localUser)).result).toMatchObject({ id: 'i-1', status: 'done' });
  await expect(close('again', localUser)).rejects.toMatchObject({ code: 'CONFLICT' });
});
```

Then run all checks:

```sh
bun run format && bun run generate && bun run typecheck && bun test showcase/examples/inspection-desk
```

Confirm that the close-command test passes with the collection tests. A second call with a new idempotency key must reach the handler and return `CONFLICT`; replaying the original key would return its stored result.

**Close an inspection from the CLI.** Start `bun run dev:web`, then:

```sh
bun run cli inspection list --output text           # copy an id
bun run cli inspection close --id <id> --key close-1
bun run cli inspection close --id <id> --key close-2; echo "exit $?"
```

You should see the inspection with `"status":"done"`, then `{"error":{"code":"CONFLICT","message":"Inspection is already done"}}` and `exit 5`.

The command has no button yet; `ui: { exception: ... }` says so. To add one, see [build-screens](../packages/frame/skills/build-screens/SKILL.md).

## Connect an agent over MCP

**List the tools.** With the app running and `TORTOISE_CONNECTION` set:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun run --silent mcp
```

You should see tools named `inspection_list`, `inspection_create`, `inspection_close` and so on. To give Claude Code or Codex these tools, register `bun run mcp` as an MCP server with `TORTOISE_CONNECTION` in its environment. The coding tool starts this command from the exported repository root. Use that tool's current MCP configuration instructions to register the process and environment.

## Run the browser test

Install the browser once, then run the application's Playwright spec:

```sh
bunx playwright install chromium
bunx playwright test showcase/examples/inspection-desk
```

The browser check should create and edit an inspection through the running host. A passing unit suite alone does not exercise that UI path.

## Next

Continue with the [Tool Store tutorial](tutorials/tool-store-1-records-and-screens.mdx) to build a tool-loan application with a coding agent. [Operations and state](capability-authoring.md) describes how commands execute against workspace state.

The default export copies framework source into the new repository. `scaffold new --registry <url>` or `--published` selects installed packages instead. Registry export requires an explicitly configured package source; a local release registry can be started with `bun run release:serve`.

The source export currently retains skill links to applications it omits, which can make its full `bun run check` fail at skill validation. Run the focused checks shown in this tutorial and report that limitation separately. The [development guide](development-and-testing.md) describes the full repository checks.
