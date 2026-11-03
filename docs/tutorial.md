# Tutorial: a tool store app

You will build the tool store of a transformer plant: the room where attendants lend shared tools such as torque wrenches, crimpers and insulation testers to employees and take them back. Each tool has an asset tag like `TC-00601`. Use Claude Code or Codex. Each step gives you the goal, the prompt to paste, and how to check the result.

Do [Getting started](getting-started.md) first, so you know what the prompts ask for.

## Setup

1. Install Bun and the browser for Playwright: `bunx playwright install chromium`.
2. Open Claude Code or Codex at the root of this repository for step 1. From step 2 on, open it at the root of the exported `tool-store` repository. `bun install` there links the skills into `.claude/skills/` and `.agents/skills/`.
3. For each step: paste the prompt, wait, run the check, then commit. One commit per step lets you redo a step with `git reset --hard HEAD`.

Every step's check starts with these commands. You should see no errors and `0 fail`:

```sh
bun run format && bun run generate && bun run typecheck
bun test showcase/examples/tool-store
```

Steps that change screens add:

```sh
bun run build
bunx playwright test showcase/examples/tool-store   # all passed
```

To try the app by hand, run it in one terminal and point the CLI at it from another:

```sh
bun run --cwd showcase/examples/tool-store dev:web
export AGENT_NATIVE_CONNECTION=$PWD/showcase/examples/tool-store/.workspace/.connection.json
```

Do not run `bun run check:skills` in the export: it fails on links to examples the export left out.

## 1. Export the app

**Goal:** a new repository with a `tool` collection, default screens and tests. **Skill:** `create-agent-native-app`.

```text prompt
Use the create-agent-native-app skill. Create the application for the tool store of a power
transformer plant at /path/to/tool-store, with the name tool-store, the display name "Tool Store"
and the first collection tool. Attendants at the store counter lend torque wrenches, crimpers,
insulation testers and gauges to employees. One build serves the store for 180 days.

Export it with scaffold new and initialize Git in the new directory. Install it, run the checks
the scaffold prints, and commit the result. Then start it with bun run dev:web in
showcase/examples/tool-store, and from the new repository's root create one tool through the CLI,
list the tools through the CLI and through the MCP bridge, and stop the instance. Report each
command and what it printed.
```

**Check:** the report shows `bun test` passing and the same tool in the CLI list and the MCP list.

## 2. Tool records

**Goal:** replace the generated title and status with the store's real tool fields, and rename `editor` to `attendant`. **Skills:** `add-capability`, `build-screens`.

```text prompt
Use the add-capability skill and the build-screens skill. In showcase/examples/tool-store,
replace the generated tool record with the store's tool record. Keep id, createdBy and createdAt.

- assetTag: the etched tag, TC- followed by five digits, unique among tools.
- description: such as "Torque wrench 20-100 Nm".
- category: torque-tool, crimper, insulation-tester, gauge, hand-tool or power-tool.
- bin: the shelf bin, such as A-03.
- status: available, checked-out, in-repair, missing or retired. A new tool is available.
- calibrationDue: an optional date, for tools that need calibration.

tool.create takes assetTag, description, category, bin and calibrationDue, and refuses a
duplicate asset tag. tool.update changes description, category, bin and calibrationDue. The
asset tag is the record's title. Rename the editor role to attendant; attendants write and
viewers read. The tool list shows asset tag, description, bin and status, filters by status and
category, and searches asset tag and description. The workspace holds only trial records, so
delete showcase/examples/tool-store/.workspace instead of writing a state migration. Update the
tests, the Playwright spec and the application README for the new record. Run the checks the
add-capability skill names and report what passed.
```

**Check:** the standard checks, then with the app running:

```sh
bun run cli tool create --asset-tag TC-00601 --description "Torque wrench 20-100 Nm" --category torque-tool --bin A-03 --key t1
bun run cli tool create --asset-tag TC-00601 --description "Copy" --category gauge --bin A-04 --key t2; echo "exit $?"
```

You should see the first tool with `"status":"available"`, then an error and a non-zero exit for the duplicate tag.

## 3. Loans

**Goal:** check a tool out and back in. Only these two commands write loans. **Skill:** `add-capability`.

```text prompt
Use the add-capability skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add collection loan
bun run scaffold add capability tool.check-out --kind command --description "Lend an available tool to an employee for a work order. Attendants only."
bun run scaffold add capability tool.return --kind command --description "Take a lent tool back and record its condition. Attendants only."

A loan records toolId, the tool's assetTag, borrower (an employee number, E followed by six
digits), workOrder, dueAt, checkedOutBy, checkedOutAt, and on return returnedAt, returnedBy,
condition (ok or damaged) and note. Remove the generated loan create and update commands, so only
these two commands write loans; members read loans.

tool.check-out takes toolId, borrower, workOrder and dueAt. It refuses a tool that is not
available with CONFLICT, creates the open loan and sets the tool to checked-out in the same
transaction. tool.return takes toolId, condition and an optional note, closes the tool's open
loan and sets the tool to available when the condition is ok or in-repair when it is damaged.
Bind both commands to the tool screen. Write behavioral tests for a viewer refused, a stale
revision refused, a repeated idempotency key returning the same receipt, and a second check-out
refused. Run the checks the add-capability skill names and report what passed.
```

**Check:** the standard checks, then with the tool from step 2 (`bun run cli tool list --output text` shows its id):

```sh
bun run cli tool check-out --tool-id <id> --borrower E104233 --work-order WO-58812 --due-at 2026-12-01T14:00:00Z --key out-1
bun run cli tool check-out --tool-id <id> --borrower E104233 --work-order WO-58812 --due-at 2026-12-01T14:00:00Z --key out-2; echo "exit $?"
bun run cli tool return --tool-id <id> --condition damaged --key back-1
```

You should see the tool `checked-out`, then `CONFLICT` with `exit 5`, then the tool `in-repair`.

## 4. Overdue tools

**Goal:** a query that lists loans past their due time. **Skill:** `add-capability`.

```text prompt
Use the add-capability skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add capability loan.overdue --kind query --description "List open loans past their due time, oldest due first. Members."

The query takes an optional borrower and the usual page arguments, and returns open loans whose
dueAt is before the time the query runs, with the tool's asset tag and description. Filter the
rows before paging and counting. Test it with a fixed clock: it lists a loan due one minute
ago, leaves out a loan due in one minute and a returned loan, and a viewer can call it. Run the
checks the add-capability skill names and report what passed.
```

**Check:** the standard checks. Check out a tool with `--due-at` in the past; `bun run cli loan overdue --output text` lists it.

## 5. Counter screen

**Goal:** the screen the attendant uses at the window. **Skill:** `build-screens`.

```text prompt
Use the build-screens skill. In showcase/examples/tool-store, replace the default tool record
screen with the counter screen:

- the tool's asset tag, description, bin, status and calibration due date;
- when the tool is available, a check-out form for borrower, work order and due time;
- when the tool is checked out, the open loan and a return form for condition and note;
- the tool's past loans, newest first.

Add an Overdue screen to the navigation that lists loan.overdue and updates when a loan changes.
Share the open tool with agent runs through the UI session. Bind every operation that still has
a headless exception, keep the UI-binding test passing, and extend the Playwright spec: create a
tool, check it out with a due time in the past, find it on the Overdue screen, return it damaged
and see the status in-repair. Run the checks the build-screens skill names and report what
passed.
```

**Check:** the standard checks and the Playwright run. In the browser, open a tool: you see a check-out form when it is available and a return form when it is out. The **Overdue** tab is in the navigation.

## 6. Shift handover

**Goal:** a handover log, written as a reusable feature. **Skill:** `write-a-feature`.

```text prompt
Use the write-a-feature skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add feature handover --screens

Shape it into the handover log between store shifts. An entry records the shift (early, late or
night), the text, recordedBy and recordedAt. Attendants record entries, and only a person may
record one, never an agent. Every member reads them. The Handover screen lists the latest
entries first with a form above them. Keep the feature's access view and conformance test, and
remove any application policy rule the feature now owns. Run the checks the write-a-feature skill
names and report what passed.
```

**Check:** the standard checks. The **Handover** screen shows a form and the newest entries first.

## 7. Asset tag scanning

**Goal:** a keyboard-wedge scanner does what the attendant would type. **Skill:** `add-scanner-input`.

```text prompt
Use the add-scanner-input skill. In showcase/examples/tool-store, add a keyboard wedge scanner at
the store counter. A scan route for asset tags (TC- followed by five digits) opens that tool's
counter screen from any screen. On the counter screen's check-out form, a scan of an employee
badge (E followed by six digits) fills the borrower. A scan never submits a command by itself;
the attendant confirms. Mount the device feature with its access view, and keep a scan burst
from firing keyboard shortcuts. Test both routes and an unknown code, and add the scan to the
Playwright spec as a typed burst. Run the checks the add-scanner-input skill names and report
what passed.
```

**Check:** the standard checks and the Playwright run. In the browser, type `TC-00601` quickly and press Enter on any screen: the counter screen for that tool opens.

## 8. Attendant sign-in

**Goal:** badge and PIN sign-in at the shared store terminal. **Skill:** `sign-in-at-a-terminal`.

```text prompt
Use the sign-in-at-a-terminal skill. In showcase/examples/tool-store, the store counter has one
shared terminal. Put the counter screen and the Overdue screen behind workstation sign-in with an
attendant badge (E followed by six digits) and a PIN, and sign the attendant out after five idle
minutes. Check-outs and returns record the signed-in attendant as checkedOutBy and returnedBy.
The workspace owner enrolls badges on the badge screen. Write an HTTP test that enrolls a badge,
signs in, checks out a tool as that attendant, refuses a viewer's badge for a check-out, and
refuses a revoked badge. Run the checks the sign-in-at-a-terminal skill names and report what
passed.
```

**Check:** the standard checks. The counter screen asks for a badge and PIN, and a check-out records the signed-in attendant as `checkedOutBy`.

## 9. Repair orders

**Goal:** a damaged return sends a repair order to the plant's EAM through the outbox. The EAM is a fake. **Skill:** `connect-system-of-record`.

```text prompt
Use the connect-system-of-record skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add target eam --collection tool

The plant EAM owns the tool master data and the repair orders. A return with condition damaged
enqueues a repair order effect in the same transaction, with the asset tag, the note and the
attendant who took the tool back. The EAM accepts it with a repair order number, which the tool
screen shows; it rejects an asset tag it does not know with ASSET_UNKNOWN, which the tool screen
shows as needing attention. The outbox holds a delivery whose outcome is unknown, and a
reconciliation screen resolves it. Inbound sync takes description, category, bin and calibration due date
from the EAM's feed by asset tag, and never changes status.

Keep the in-memory fake EAM port, make its behavior deterministic, and let
DEMO_EAM_UNKNOWN_TAGS name asset tags it rejects in the demo. Test an accepted order, a rejection,
a lost reply the dispatcher holds and a person resolves, and a stale feed item. Run the checks the
connect-system-of-record skill names and report what passed.
```

**Check:** the standard checks. Return a tool as damaged: its screen shows a repair order number. Start the app with `DEMO_EAM_UNKNOWN_TAGS=TC-00601` and do the same: the screen shows the tool as needing attention.

## 10. Repair triage agent

**Goal:** an agent that proposes retiring worn-out tools; an attendant approves. **Skill:** `add-capability`.

```text prompt
Use the add-capability skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add agent repair-triage --collection tool

Rewrite the agent for repair triage. For a tool in repair, it reads the tool's loans and repair
orders. It requests approval to retire the tool when the tool came back damaged three times in 90
days or the last note says it is beyond repair, and requests nothing otherwise. It may only read
tools and loans and request approval for tool.retire. Add tool.retire as an attendant command
that sets the status to retired. An attendant approves or rejects on the Approvals screen. Write
the agent's scripted scenarios for both outcomes. Run the checks the add-capability skill names
and report what passed.
```

**Check:** the standard checks; the scripted scenarios for both outcomes pass. Proposals appear on the **Approvals** screen.

## 11. Cycle counts

**Goal:** hand a bin count to an attendant and accept the report. **Skill:** `assign-work`.

```text prompt
Use the assign-work skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add assignment-kind cycle-count --collection tool

Shape it into a bin count. The scope is one bin; the brief lists the bin and the asset tags
expected there with their status. The report lists the tags found and the tags missing.
Accepting the report sets each missing tool to missing and each found tool that was missing back
to available, through tool commands. Attendants plan, work and review counts; viewers read them.
Test the lifecycle for each role, a report naming a tag outside the bin, and an accept that
refuses a checked-out tool reported missing. Run the checks the assign-work skill names and report
what passed.
```

**Check:** the standard checks. Accepting a report that lists a tag as missing sets that tool to `missing`.

## 12. Calibration over MCP and the CLI

**Goal:** Claude Code uses the app over MCP while you watch the records change in the CLI. **Skill:** `add-capability`.

```text prompt
Use the add-capability skill. For the application in showcase/examples/tool-store, run
from the repository root:

bun run scaffold add capability tool.calibration-due --kind query --description "List tools whose calibration falls due within a number of days, soonest first. Members."

The query takes days (1 to 90, default 14) and the usual page arguments, and returns the tools
that are not retired and whose calibrationDue is on or before the day the query runs plus days.
Filter the rows before paging and counting.

Add workflow text named calibration-pull for an agent that pulls tools due for calibration:
call tool.calibration-due, and for each available tool not in bin CAL-01 call tool.update with
bin CAL-01 and the revision just read. Leave checked-out tools where they are and list them in
the answer. Name operation IDs only. Read the tool operations' descriptions as a model reads
them in the MCP tool list, and make each command's description say which role may call it and
that a stale revision conflicts.

Test the query with a fixed clock. Write a test through the MCP adapter that lists the
tool.calibration-due tool and the calibration-pull workflow resource, calls tool.update with the
revision a tool.get returned, and gets CONFLICT for a stale revision. Run the checks the
add-capability skill names and report what passed.
```

**Check:** the standard checks. Then start the app, register three tools due for calibration and lend one:

```sh
bun run --cwd showcase/examples/tool-store dev:web
export AGENT_NATIVE_CONNECTION=$PWD/showcase/examples/tool-store/.workspace/.connection.json
bun run cli tool create --asset-tag TC-00601 --description "Torque wrench 20-100 Nm" --category torque-tool --bin A-03 --calibration-due 2026-10-31 --key create-wrench
bun run cli tool create --asset-tag TC-00602 --description "Insulation tester 5 kV" --category insulation-tester --bin B-01 --calibration-due 2026-11-05 --key create-tester
bun run cli tool create --asset-tag TC-00603 --description "Crimper 6-50 mm2" --category crimper --bin C-02 --calibration-due 2026-11-09 --key create-crimper
bun run cli tool check-out --tool-id <crimper id> --borrower E104233 --work-order WO-58812 --due-at 2026-10-30T14:00:00Z --key lend-crimper
```

Give Claude Code the app's MCP tools only, and the task:

```sh
claude mcp add --scope project tool-store -e AGENT_NATIVE_CONNECTION=$AGENT_NATIVE_CONNECTION -- bun run mcp
claude -p "Pull the tools due for calibration in the tool-store application. Read the calibration-pull workflow resource first and follow it." \
  --allowedTools mcp__tool-store ListMcpResourcesTool ReadMcpResourceTool \
  --disallowedTools Bash Edit Write
bun run --silent cli tool list --output text
```

You should see the wrench and the tester moved to bin `CAL-01`, and the lent crimper still in `C-02` (columns trimmed):

```text
assetTag  description              bin     status       calibrationDue
TC-00603  Crimper 6-50 mm2         C-02    checked-out  2026-11-09
TC-00602  Insulation tester 5 kV   CAL-01  available    2026-11-05
TC-00601  Torque wrench 20-100 Nm  CAL-01  available    2026-10-31
```

The model chooses its own calls, so another run can differ. Remove the server with `claude mcp remove --scope project tool-store`.

## 13. Selection and UI intents

**Goal:** the attendant selects tools, starts an agent run on them, and the run opens a tool and asks the attendant to review a change. The run never writes. **Skill:** `build-screens`.

```text prompt
Use the build-screens skill. In showcase/examples/tool-store, let an attendant signed in at the
terminal start an agent run on the tools selected in the terminal's work area, and let the run
open a tool at the counter and ask the attendant to review a change.

- A Tools tab beside Counter and Overdue lists the tools, with a checkbox on each row that
  selects it. The work area shares the selected tools as the UI session context, each as
  tool:<id> with the revision the row shows. Add the tool kind to the application's selectable
  resources if it is missing.
- An agent panel under the list holds the Accounts component for the harness, a brief, a Start
  run button and the RunPanel, and shows the tools the latest run captured. The deterministic
  demo harness gets a script that reads each selected tool with tool.get.
- A Pull for calibration action starts a demo run that sends ui.open for the first selected tool
  and ui.request-review with the title "Pull <assetTag> for calibration", the operation
  tool.update and that tool. A provider harness gets the brief with an instruction to use
  ui.open and ui.request-review and to leave the change to the attendant.
- The work area handles the intents through useUiSession. An open shows the tool at the counter
  instead of navigating, since leaving the terminal ends the session. A review that names
  tool.update shows its title above the tool's update form on the counter, with the bin field
  focused. The attendant enters the bin and submits; the run never writes. Acknowledging the
  review closes it.

Keep the terminal's style. Give the review the warning token's border and a line that names the
run. Write an HTTP test in which a run's ui.open and ui.request-review reach the session the run
captured, the host refuses a ui.open for an unknown tool, and a run started without a session has
no ui tools. Add a Playwright spec: sign in at the terminal, select a tool on the Tools tab, start
the demo run, see the counter open with the review, submit the bin and see the tool's bin
change. Run the checks the build-screens skill names and report what passed.
```

**Check:** the standard checks and the Playwright run, including the new spec.

## 14. Site deployment

**Goal:** a signed install bundle, installed under a temporary prefix and removed again. **Skills:** `deploy-to-site`, `decommission-an-application`.

```text prompt
Use the deploy-to-site skill and the decommission-an-application skill. In the tool-store
repository, write a deployment policy for the store terminal that binds the EAM destination to
https://eam.plant.example, and disables every other destination. Check it with the site check,
export the network rules, build the CLI, and create, verify and admit a signed bundle with a
throwaway key. Install the bundle under a temporary prefix with no service, show its status,
drain it and uninstall it with purge. Do not apply anything outside the prefix. Report each
command and what it printed, and say which steps only stage on this operating system. Run the
checks the deploy-to-site skill names and report what passed.
```

**Check:** the report lists each command and its output, ending with the uninstall. Nothing outside the prefix changed. On macOS the install writes the service and firewall files but does not load them.

## What this tutorial does not cover

Everything runs on fakes: no real EAM, scanner, badge reader or model, except Claude Code in step 12. These skills need hardware or services a laptop lacks: `run-agent-tools-in-a-sandbox` (Linux with bubblewrap), `run-a-hosted-instance` (Postgres and a TLS certificate), `extend-mobile-host` (a phone or emulator), `bridge-station-screen`, `connect-a-site-to-a-fleet` and `write-host-plugin`. [AGENTS.md](../AGENTS.md#skills) lists the skills.
