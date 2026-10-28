# Tutorial

The tutorial builds one [application](glossary.md#application) step by step, from a generated skeleton to a staged site install. Each step is a prompt for a coding agent, such as Claude Code or Codex, and names the skill the agent follows. The application is the tool crib of a power transformer plant. Attendants at the crib window lend torque wrenches, crimpers, insulation testers and gauges to employees, and each tool has an etched asset tag.

## Concepts

Terms: [scaffold](glossary.md#scaffold), [collection](glossary.md#collection), [capability](glossary.md#capability), [command](glossary.md#command), [query](glossary.md#query), [policy](glossary.md#policy), [UI binding](glossary.md#ui-binding), [feature](glossary.md#feature), [input source](glossary.md#input-source), [workstation sign-in](glossary.md#workstation-sign-in), [target](glossary.md#target), [outbox](glossary.md#outbox), [reconciliation](glossary.md#reconciliation), [agent definition](glossary.md#agent-definition), [approval request](glossary.md#approval-request), [surface](glossary.md#surface), [UI session context](glossary.md#ui-session-context), [UI intent](glossary.md#ui-intent), [assignment kind](glossary.md#assignment-kind), [deployment policy](glossary.md#deployment-policy) and [site bundle](glossary.md#site-bundle).

## Setup

The first step runs in the framework repository and exports a new repository with `scaffold new`. Every later step runs at the root of that export. `bun install` in the export links the skills into `.claude/skills/` for Claude Code and `.agents/skills/` for Codex, and the agent reads the export's `AGENTS.md`.

1. Install Bun 1.4.4 and the Playwright browsers with `bunx playwright install chromium`.
2. Start the coding agent at the root of the framework repository for the first step, and at the root of the export for the others.
3. Paste the step's prompt.
4. Review the diff and commit it before the next step, so each step can be reset on its own.

`scaffold add` runs from the export root. Its policy rules, descriptions and tests name the generated `editor` role, which the tool records step renames to attendant, so each later step renames it in the generated part.

`bun run check` fails in a source export at `check:readmes` and `check:skills`, because the copied READMEs and skills link to examples the export leaves out. The steps use these checks instead, from the export root:

```sh
bun run format
bun run generate
bun run typecheck
bun test showcase/examples/tool-crib
```

A step that changes screens also runs these:

```sh
bun run build
bunx playwright test showcase/examples/tool-crib
```

## Application export

Skill: `create-agent-native-app`. The step exports the framework, the starter and a generated application in `showcase/examples/tool-crib` with one `tool` collection, default list and record screens, and the site, network, audit and compliance plugins.

```text
Use the create-agent-native-app skill. Create the application for the tool crib of a power
transformer plant at /path/to/tool-crib, with the name tool-crib, the display name "Tool Crib"
and the first collection tool. Attendants at the crib window lend torque wrenches, crimpers,
insulation testers and gauges to employees. One build serves the crib for 180 days.

Export it with scaffold new and initialize Git in the new directory. Install it, run the checks
the scaffold prints, and commit the result. Then start it with bun run dev:web in
showcase/examples/tool-crib, and from the new repository's root create one tool through the CLI,
list the tools through the CLI and through the MCP bridge, and stop the instance. Report each
command and what it printed.
```

The agent reports a passing test run, the tool it created and the same tool in both lists.

## Tool records

Skills: `add-capability` and `build-screens`. The step replaces the generated `title` and `open`/`done` status with the crib's tool record and renames the roles.

```text
Use the add-capability skill and the build-screens skill. In showcase/examples/tool-crib,
replace the generated tool record with the crib's tool record. Keep id, createdBy and createdAt.

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
delete .workspace at the repository root instead of writing a state migration. Update the
tests, the Playwright spec and the application README for the new record. Run the checks the
add-capability skill names and report what passed.
```

## Loans

Skill: `add-capability`. The step adds a `loan` collection and the two commands an attendant runs at the window. A loan is written only by those commands.

```text
Use the add-capability skill. For the application in showcase/examples/tool-crib, run
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

## Overdue tools

Skill: `add-capability`. The step adds a query that every member may call.

```text
Use the add-capability skill. For the application in showcase/examples/tool-crib, run
from the repository root:

bun run scaffold add capability loan.overdue --kind query --description "List open loans past their due time, oldest due first. Members."

The query takes an optional borrower and the usual page arguments, and returns open loans whose
dueAt is before the time the query runs, with the tool's asset tag and description. Filter the
rows before paging and counting. Test it with a fixed clock: a loan due one minute ago is
listed, a loan due in one minute and a returned loan are not, and a viewer can call it. Run the
checks the add-capability skill names and report what passed.
```

## Crib counter screen

Skill: `build-screens`. The step replaces the default tool record screen with the screen an attendant works on at the window.

```text
Use the build-screens skill. In showcase/examples/tool-crib, replace the default tool record
screen with the crib counter screen:

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

## Shift handover

Skill: `write-a-feature`. The step adds a handover log as a [feature](glossary.md#feature) the application mounts.

```text
Use the write-a-feature skill. For the application in showcase/examples/tool-crib, run
from the repository root:

bun run scaffold add feature handover --screens

Shape it into the handover log between crib shifts. An entry records the shift (early, late or
night), the text, recordedBy and recordedAt. Attendants record entries, and only a person may
record one, never an agent. Every member reads them. The Handover screen lists the latest
entries first with a form above them. Keep the feature's access view and conformance test, and
remove any application policy rule the feature now owns. Run the checks the write-a-feature skill
names and report what passed.
```

## Asset tag scanning

Skill: `add-scanner-input`. The step lets a keyboard wedge scanner at the window do what an attendant would type.

```text
Use the add-scanner-input skill. In showcase/examples/tool-crib, add a keyboard wedge scanner at
the crib window. A scan route for asset tags (TC- followed by five digits) opens that tool's
counter screen from any screen. On the counter screen's check-out form, a scan of an employee
badge (E followed by six digits) fills the borrower. A scan never submits a command by itself;
the attendant confirms. Mount the device feature with its access view, and keep a scan burst
from firing keyboard shortcuts. Test both routes and an unknown code, and add the scan to the
Playwright spec as a typed burst. Run the checks the add-scanner-input skill names and report
what passed.
```

## Attendant sign-in

Skill: `sign-in-at-a-terminal`. The step puts the counter screen behind a badge and PIN at the shared crib terminal.

```text
Use the sign-in-at-a-terminal skill. In showcase/examples/tool-crib, the crib window has one
shared terminal. Put the counter screen and the Overdue screen behind workstation sign-in with an
attendant badge (E followed by six digits) and a PIN, and sign the attendant out after five idle
minutes. Check-outs and returns record the signed-in attendant as checkedOutBy and returnedBy.
The workspace owner enrolls badges on the badge screen. Write an HTTP test that enrolls a badge,
signs in, checks out a tool as that attendant, refuses a viewer's badge for a check-out, and
refuses a revoked badge. Run the checks the sign-in-at-a-terminal skill names and report what
passed.
```

## Repair orders

Skill: `connect-system-of-record`. The step sends a repair order to the plant's EAM through the [outbox](glossary.md#outbox) when a tool comes back damaged, and keeps the tool master data in step with the EAM.

```text
Use the connect-system-of-record skill. For the application in showcase/examples/tool-crib, run
from the repository root:

bun run scaffold add target eam --collection tool

The plant EAM owns the tool master data and the repair orders. A return with condition damaged
enqueues a repair order effect in the same transaction, with the asset tag, the note and the
attendant who took the tool back. The EAM accepts it with a repair order number, which the tool
screen shows; it rejects an asset tag it does not know with ASSET_UNKNOWN, which the tool screen
shows as needing attention. A delivery whose outcome is unknown is held and resolved on a
reconciliation screen. Inbound sync takes description, category, bin and calibration due date
from the EAM's feed by asset tag, and never changes status.

Keep the in-memory fake EAM port, make its behavior deterministic, and let
DEMO_EAM_UNKNOWN_TAGS name asset tags it rejects in the demo. Test an accepted order, a rejection,
a lost reply that is held then resolved, and a stale feed item. Run the checks the
connect-system-of-record skill names and report what passed.
```

## Repair triage agent

Skill: `add-capability`, at its agent scenario step. The step adds an [agent definition](glossary.md#agent-definition) whose proposals an attendant approves.

```text
Use the add-capability skill. For the application in showcase/examples/tool-crib, run
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

## Cycle counts

Skill: `assign-work`. The step hands a bin count to an attendant as an assignment and takes the count back as a report a second attendant accepts.

```text
Use the assign-work skill. For the application in showcase/examples/tool-crib, run
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

## Calibration over MCP and the CLI

Skill: `add-capability`. The step adds a query for tools due for calibration and workflow text for an agent that reaches the application over MCP. A coding agent connected through the MCP bridge, a script on the CLI and the attendant's screen then work on the same tool records.

```text
Use the add-capability skill. For the application in showcase/examples/tool-crib, run
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
revision a tool.get returned, and is refused with a stale revision. Run the checks the
add-capability skill names and report what passed.
```

Start the instance and point the CLI and the MCP bridge at its connection file:

```sh
PORT=4330 bun run --cwd showcase/examples/tool-crib dev:web
export AGENT_NATIVE_APPLICATION=@tool-crib/application
export AGENT_NATIVE_CONNECTION=$PWD/showcase/examples/tool-crib/.workspace/.connection.json
```

Register three tools due within 14 days through the CLI and lend one of them:

```sh
bun run cli tool create --asset-tag TC-00601 --description "Torque wrench 20-100 Nm" --category torque-tool --bin A-03 --calibration-due 2026-10-31 --key create-wrench
bun run cli tool create --asset-tag TC-00602 --description "Insulation tester 5 kV" --category insulation-tester --bin B-01 --calibration-due 2026-11-05 --key create-tester
bun run cli tool create --asset-tag TC-00603 --description "Crimper 6-50 mm2" --category crimper --bin C-02 --calibration-due 2026-11-09 --key create-crimper
bun run cli tool check-out --tool-id <crimper ID> --borrower E104233 --work-order WO-58812 --due-at 2026-10-30T14:00:00Z --key lend-crimper
```

Register the MCP bridge with Claude Code in the project config and give it the task with the application's tools and resources only. The bridge reads the connection file, so it acts as the instance owner over HTTP:

```sh
claude mcp add --scope project tool-crib -e AGENT_NATIVE_APPLICATION=$AGENT_NATIVE_APPLICATION -e AGENT_NATIVE_CONNECTION=$AGENT_NATIVE_CONNECTION -- bun run mcp
claude -p "Pull the tools due for calibration in the tool-crib application. Read the calibration-pull workflow resource first and follow it." \
  --allowedTools mcp__tool-crib ListMcpResourcesTool ReadMcpResourceTool \
  --disallowedTools Bash Edit Write
```

Claude Code reads `app://workflows/calibration-pull`, calls `tool_calibration_due`, and calls `tool_update` for the wrench and the tester with the revisions it read. It leaves the lent crimper in its bin and names it in its answer. The CLI list shows the bins it set:

```sh
bun run --silent cli tool list --output text
```

```text
id                                    assetTag  description              category           bin     status       calibrationDue  createdBy  createdAt      revision
e8ade5f3-8e3c-4479-adc3-403224a18ba7  TC-00603  Crimper 6-50 mm2         crimper            C-02    checked-out  2026-11-09      owner      1793176075611  2
5a44d7c9-262b-4dc8-9ac2-fb092be2261b  TC-00602  Insulation tester 5 kV   insulation-tester  CAL-01  available    2026-11-05      owner      1793176075515  4
85e6b25d-f3c3-4189-a961-c6255dfb06a0  TC-00601  Torque wrench 20-100 Nm  torque-tool        CAL-01  available    2026-10-31      owner      1793176069619  4
```

The model decides its calls, so another run can differ. `claude mcp remove --scope project tool-crib` removes the registration.

## Selection and UI intents

Skill: `build-screens`. The step lets an attendant signed in at the terminal select tools in the terminal's work area and start an agent run on them. The run reads the selection as its [UI session context](glossary.md#ui-session-context) and sends [UI intents](glossary.md#ui-intent) back to the attendant's screen. It changes no record; the attendant submits the form.

```text
Use the build-screens skill. In showcase/examples/tool-crib, let an attendant signed in at the
terminal start an agent run on the tools selected in the terminal's work area, and let the run
open a tool at the counter and ask the attendant to review a change.

- A Tools tab beside Counter and Overdue lists the tools, with a checkbox on each row that
  selects it. The work area shares the selected tools as the UI session context, each as
  tool:<id> with the revision the row shows. List the tool kind in the application's selectable
  resources if it is not listed.
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
captured, a ui.open for an unknown tool is refused, and a run started without a session has no
ui tools. Add a Playwright spec: sign in at the terminal, select a tool on the Tools tab, start
the demo run, see the counter open with the review, submit the bin and see the tool's bin
change. Run the checks the build-screens skill names and report what passed.
```

The agent reports the HTTP test and the Playwright spec passing. The run acts as the terminal's principal, not the signed-in attendant, and the attendant's own client submits the bin form.

## Site deployment

Skills: `deploy-to-site` and `decommission-an-application`. The step binds the EAM in a [deployment policy](glossary.md#deployment-policy), builds a signed [site bundle](glossary.md#site-bundle), installs it under a staging prefix and removes it again.

```text
Use the deploy-to-site skill and the decommission-an-application skill. In the tool-crib
repository, write a deployment policy for the crib terminal that binds the EAM destination to
https://eam.plant.example, and disables every other destination. Check it with the site check,
export the network rules, build the CLI, and create, verify and admit a signed bundle with a
throwaway key. Install the bundle under a temporary prefix with no service, show its status,
drain it and uninstall it with purge. Do not apply anything outside the prefix. Report each
command and what it printed, and say which steps only stage on this operating system. Run the
checks the deploy-to-site skill names and report what passed.
```

## Limits

- The tutorial runs with fakes only. No step reaches a real EAM, scanner, badge reader or model, and the triage agent runs its scripted scenarios. The only model is the coding agent that calls the application over MCP in the calibration step.
- On macOS, the install in the last step writes the unit and firewall files under the prefix and loads neither.
- These skills have no step, because they need something an export or a laptop lacks:
  - `run-agent-tools-in-a-sandbox`: Linux with bubblewrap;
  - `run-a-hosted-instance`: Postgres and a trusted certificate;
  - `extend-mobile-host`: an emulator or a phone;
  - `bridge-station-screen`: the fake HMI of the winding-line example;
  - `connect-a-site-to-a-fleet`: the fleet example;
  - `write-host-plugin`: a plugin in `plugins/` rather than application code.

## References

- [Getting started](getting-started.md#new-application)
- [create-agent-native-app](../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [add-capability](../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../packages/frame/skills/build-screens/SKILL.md)
- [write-a-feature](../packages/host/skills/write-a-feature/SKILL.md)
- [add-scanner-input](../packages/devices/skills/add-scanner-input/SKILL.md)
- [sign-in-at-a-terminal](../workstations/sign-in/skills/sign-in-at-a-terminal/SKILL.md)
- [connect-system-of-record](../packages/integration/skills/connect-system-of-record/SKILL.md)
- [assign-work](../packages/assignments/skills/assign-work/SKILL.md)
- [deploy-to-site](../plugins/site/skills/deploy-to-site/SKILL.md)
- [decommission-an-application](../plugins/site/skills/decommission-an-application/SKILL.md)
- [check-a-change](../packages/testing/skills/check-a-change/SKILL.md)
- [Capability authoring](capability-authoring.md)
- [Patterns](patterns.md)
