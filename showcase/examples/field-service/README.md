# Field service work orders

A dispatcher opens a work order for a customer site and adds technicians and customers as members. The team records tasks, attaches photos or PDFs, and updates progress. A dispatcher-only internal note illustrates field-level access: other members cannot read, search or sort by that note.

The framework repository's starter selects `field-service` in `app.config.json`. The example also contains a deterministic agent demo and a webhook that stands in for a customer portal.

## Try the example

From the repository root:

```sh
cd showcase/examples/field-service
bun run dev:web
```

The browser host listens on port 4321. Create a work order and a task, then choose **Create tasks from brief**. The offline harness turns each line of the brief into a task command without a provider account. Use `bun run dev` for a desktop window.

A separate start-of-shift job can move up to 100 todo tasks to doing. While the host is running, set `AGENT_NATIVE_CONNECTION` to its connection file and run `bun run job <work-order-id>` from this directory.

## Editing and reminders

A task edit starts with the revision the person read. If another caller commits a change, the [live query](../../../docs/primitives.md#journal-and-live-query) refreshes the list but the editor's draft stays in place. Saving with a stale revision returns `CONFLICT`, allowing the person to compare and retry instead of silently overwriting the other change.

A task reminder commits an outbox effect with the task. The notification waits until a desktop window or phone is attached for the recipient. Its **Mark done** reply is a separate request under the replying person's access; replaying the same reply does not complete the task twice.

[`ui/work-orders/task-row.tsx`](ui/work-orders/task-row.tsx) holds the edit flow, [`handlers/tasks.ts`](handlers/tasks.ts) changes tasks, and [`policy.ts`](policy.ts) applies membership, row scope and the internal-note projection.

## OS requests

- Links `<scheme>://tasks/<id>` and `<scheme>://work-orders/<id>` open the work order screen.
- A `.txt` or `.md` work instruction opened with the application prefills a new task from its name and text.
- A site photo (PNG or JPEG) or a PDF prefills a new task with the file attached.
- Text or a link shared from another application prefills a task's description.
- A photo or PDF shared from another application, such as the phone's camera roll, prefills a task's title and attachment.
- The launcher entry New task (`task.new`) opens an empty new task. It appears in the dock menu, the Windows jump list, an Android shortcut and the installed web application's shortcuts.

The work order screen asks the OS for two actions through `runOsAction` from `@/lib/os-browser`. The desktop shell performs them; in a browser, the page opens the URL or calls the Web Share API itself while it has the click's user activation.

- **Open map** (`work-order.site-map`, an `open` action) shows the site address on OpenStreetMap. The URL is fixed to `https://www.openstreetmap.org/search`, and the address is its only parameter.
- **Send summary** (`work-order.share`, a `share` action) passes the work order's name, site and open tasks to the share sheet as text.

## Agent panel

The agent panel's **Agent to use** list offers the harnesses the host can run. A run sees the open work order through the UI session and changes it only through the catalog.

| Harness | What it needs |
| --- | --- |
| Offline demo (`deterministic`) | Nothing. Each line of the brief becomes a `task.create` command. |
| AI SDK | An OpenAI API key saved in the panel. Runs reach `api.openai.com` through the egress guard. |
| Codex | A ChatGPT sign-in, and the bundled Codex runtime. |
| Claude | A Claude API key saved in the panel, and the bundled Claude Code runtime. |

The panel saves a key in the host's [credential vault](../../../docs/primitives.md#credential-vault), which keeps it in the OS keychain under a name derived from the workspace path.

A dev launch has no bundled runtimes, so Codex and Claude report "Bundled native runtime manifest not configured". To run them from source, stage the runtimes once and point the host at the staged manifest. Run this from the repository root, with the target of the machine.

```sh
bun run build:web
bun run package:stage darwin-arm64
AGENT_RUNTIME_MANIFEST="$PWD/artifacts/desktop/darwin-arm64/resources/runtime-manifest.json" bun run --cwd showcase/examples/field-service dev:web
```

Staging downloads the runtimes from the registry and refuses an existing target directory. The accounts are the person's own, connected in the panel; the host never reads ambient provider credentials.

## Trust boundary

The [application definition](../../../docs/glossary.md#application-definition) is trusted code that runs inside the [instance](../../../docs/glossary.md#instance).

- Every capability authorizes against current state. Roles come from work order membership and never from input.
- Membership capabilities may name a target principal and role. Those inputs never change the caller's instance.
- Task reads are scoped before filtering, pagination and counts.
- `internalNote` is projected away for everyone but the work order's dispatchers.
- Mutations take `expectedRevisions`, so concurrent edits conflict instead of overwriting.

A link or file from the OS commits nothing. A task link opens only a task the session may read, because the host authorizes the resource before it queues the delivery. A file or a share prefills only the title and description, or the title and attachment. The work order is the one the person has open.

The prefilled task (`ui/work-orders/prepared-task.tsx`) shows where the values came from. It is created only when the person adds it, with one idempotency key per prefill.

An attached file is uploaded before the request is submitted. It stays staged, readable by nobody, until the person adds the task. The runtime lets only the uploading principal attach it, within `attachmentLimits`. When a prefill is discarded, the blob store sweeps the file.

A reminder notifies the person who asked for it, and only their reply counts. Mark done runs `task.set-status` as them at the moment they choose it. A person who lost edit access since the reminder therefore cannot use it. A reminder asked for in the browser waits until the desktop or phone application runs, because a web page shows no notifications. Only the notification [dispatcher](../../../docs/glossary.md#dispatcher) may call `task-reminders.effect.complete`, as the workspace owner under its [delegated grant](../../../docs/glossary.md#grant). That dispatcher is the plugin's effect delivery loop, not the dispatcher role.

## Limits

- **Planner agent.** No test runs the `work-order.planner` definition, and the agent panel starts runs by harness and prompt only. Approval requests from this agent are unproven; the approval request test covers approval requests a customer submits.
- **State migrations.** Version 2 is the only numbered step. The upgrade step still accepts the root layout from before modules were composed, on each load.
- **Membership.** The handler fixes only the workspace owner's entry, so a dispatcher can remove or demote another dispatcher. The commit-phase check refuses a change to the caller's own dispatcher role.
- **People directory.** The access form takes a principal ID as free text. The dispatcher must know the ID; nothing lists the people who could be added.
- **Deletes.** A deleted task has no restore command. The blob store sweeps its file after the grace period.
- **Reminders in the browser.** A web page shows no notifications. A reminder requested there stays pending until a desktop window or phone runs for the same person.
- **Real OS.** No link, file, share, shortcut or notification has gone through a real operating system, per the [implementation status](../../../docs/implementation-status.md#os-integration). Staged uploads are lost when the host restarts.
- **Start-of-shift job.** The job has no automated test. It needs `AGENT_NATIVE_CONNECTION` set to a running host's connection file.
- **Full check.** In a source export, the skill check reports references to omitted examples and changed root scripts; a previous full export test also found a compliance test referring to omitted evidence. The [recorded scaffold runs](../../../docs/implementation-status.md#layers-and-scaffold) pass the whole check only for an application that installs the framework from a registry.
- **Systems of record.** The example has no target besides reminders, no inbound sync and no remote query. The customer portal is a webhook destination only.
- **Site address.** The site is free text set at creation; no capability changes it, and nothing geocodes it.
- **Provider runs.** No Codex, Claude or AI SDK run is recorded for this example.

## Checks

From the repository root:

```sh
bun test showcase/examples/field-service
bunx playwright test showcase/examples/field-service/e2e
```

The domain and conformance tests cover the role matrix, revisions and shared behavior across surfaces. `e2e/workspace.pw.ts` exercises live updates and drafts; `e2e/os.pw.ts` exercises browser-side OS flows. The [implementation status](../../../docs/implementation-status.md#os-integration) distinguishes those tests from real OS and provider runs.
