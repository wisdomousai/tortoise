# Tutorial: an in-app assistant

You will build a parts desk for a transformer plant. Utilities call about bushings, tap changer parts, gaskets and relays. An assistant panel beside every screen finds a transformer by serial, looks up parts, fills the quote form for the person to check, and asks for approval before a discount above 10 percent or a cancellation. Use Claude Code or Codex. Each step gives the goal, the prompt and the check.

Do [Getting started](getting-started.md) first. The [tool crib tutorial](tutorial.md) covers records, screens and integrations in more depth.

## Setup

1. Install Bun and `bunx playwright install chromium`.
2. Only for step 12: install llama.cpp's `llama-server` and download a GGUF instruction model that calls tools, such as Gemma 4 E4B.
3. Open Claude Code or Codex at the root of this repository for step 1, and at the root of the `parts-desk` export after that.
4. For each step: paste the prompt, run the check, commit.

The standard check, from the export root. You should see `0 fail`:

```sh
bun run format && bun run generate && bun run typecheck
bun test showcase/examples/parts-desk
```

Steps that change screens add `bun run build` and `bunx playwright test showcase/examples/parts-desk` (all passed).

## 1. Export the app

**Goal:** a new repository with an `inquiry` collection. **Skill:** `create-agent-native-app`.

```text
Use the create-agent-native-app skill. Create the application for the spare parts customer
service desk of a power transformer plant at /path/to/parts-desk, with the name parts-desk, the
display name "Parts Desk" and the first collection inquiry. Utilities call the desk about
bushings, tap changer parts, gaskets and relays for transformers in service, and the desk quotes
the parts. One build serves the desk for 180 days.

Export it with scaffold new and initialize Git in the new directory. Install it, run the checks
the scaffold prints, and commit the result. Then start it with bun run dev:web in
showcase/examples/parts-desk, and from the new repository's root create one inquiry through the
CLI, list the inquiries through the CLI and through the MCP bridge, and stop the instance. Report
each command and what it printed. Run the checks the create-agent-native-app skill names and
report what passed.
```

**Check:** the report shows `bun test` passing and the same inquiry in the CLI and MCP lists.

## 2. Transformers and parts

**Goal:** the records the desk looks up, plus seed data. Two serials share a prefix, so `TR-404` is ambiguous. **Skill:** `add-capability`.

```text
Use the add-capability skill. For the application in showcase/examples/parts-desk, run from the
repository root:

bun run scaffold add collection customer
bun run scaffold add collection transformer
bun run scaffold add collection part
bun run scaffold add capability transformer.find --kind query --description "Find transformers by serial, whole or partial. Members."
bun run scaffold add capability part.search --kind query --description "Search parts by transformer, category and text. Members."

Shape the records. Keep id, createdBy and createdAt on each.

- customer: a utility. account (U followed by four digits, unique), name and phone.
- transformer: serial (TR- followed by five digits, unique), customerId, model (the plant's
  design, such as PTX-40), ratingMva, voltage (such as "132/33 kV"), substation, yearInService
  and tapChanger (the on-load tap changer type).
- part: partNumber (unique, such as BSH-145-1250), description, category (bushing, tap-changer,
  gasket or relay), assembly (hv-bushings, lv-bushings, tap-changer, tank-cover, conservator or
  protection), fits (the transformer models it fits), unitPrice in euro cents, stock and
  leadTimeDays.
- inquiry: a utility's call. caller, customerId, an optional transformerSerial, subject and
  status (open, quoted or closed). A new inquiry is open.

The serial, account, part number and inquiry subject are the records' titles. Rename the editor
role to desk; desk members write and viewers read. transformer.find takes serial text, matches
case-insensitively on the whole serial or its start, and returns up to ten transformers with
their customer's name, an exact match first. part.search takes an optional transformerSerial,
category and text, returns the parts that fit that transformer's model, filtered before paging,
and refuses an unknown serial with NOT_FOUND.

Add showcase/examples/parts-desk/dev.ts, which dev:web runs before the launch: it opens the
workspace with openEmbeddedInstance and creates, through the commands with fixed idempotency
keys, three utilities, six transformers of three models (two of them TR-40417 and TR-40471) and
twenty-four parts across the four categories and six assemblies, some out of stock. A relaunch
adds nothing. The workspace holds only trial records, so delete
showcase/examples/parts-desk/.workspace instead of writing a state migration. Update the tests,
the Playwright spec and the application README. Run the checks the add-capability skill names
and report what passed.
```

**Check:** the standard check. Start the app with `bun run --cwd showcase/examples/parts-desk dev:web`, set `AGENT_NATIVE_CONNECTION` to `showcase/examples/parts-desk/.workspace/.connection.json`, then:

```sh
bun run cli transformer find --serial TR-404 --output text
```

You should see two rows: `TR-40417` and `TR-40471`. If the flag differs, `bun run cli help transformer find` shows it.

## 3. Quotes

**Goal:** quotes, and the rule that a discount above 10 percent needs a supervisor. **Skill:** `add-capability`.

```text
Use the add-capability skill. For the application in showcase/examples/parts-desk, run from the
repository root:

bun run scaffold add collection quote
bun run scaffold add capability quote.discount --kind command --description "Set the discount of a draft quote. Above 10 percent, supervisors only."
bun run scaffold add capability quote.submit --kind command --description "Send a draft quote to the utility. Desk."
bun run scaffold add capability quote.cancel --kind command --description "Cancel a draft or submitted quote with a reason. Desk."

A quote records number (Q- followed by five digits, assigned in order), customerId,
transformerSerial, an optional inquiryId, lines (partNumber, description, quantity from 1 to 99
and unitPrice copied from the part), discountPercent from 0 to 30, discountReason, status
(draft, submitted or cancelled), cancelReason and total in euro cents after the discount. The
number is the title.

quote.create takes customerId, transformerSerial, lines (partNumber and quantity) and an optional
inquiryId. It refuses a transformer of another customer and a part that does not fit the
transformer's model with INVALID_INPUT, creates a draft with no discount, and sets the inquiry to
quoted in the same transaction. quote.update replaces the lines of a draft. quote.discount takes
id, percent and reason for a draft. quote.submit sets a draft to submitted. quote.cancel takes id
and reason and sets a draft or submitted quote to cancelled. Every other change of status is a
CONFLICT.

Add a supervisor role that may do what desk members do. The policy refuses quote.discount above
10 percent with FORBIDDEN unless the caller is a supervisor. A run under an agent definition, whose
grant names the agent, never sets more than 10 percent, whoever started it. dev.ts adds the member
mara as a supervisor. Write behavioral tests for a part that does not fit, 10 percent allowed and
12 percent refused for desk, 12 percent allowed for a supervisor, a submitted quote that refuses
a discount, and the inquiry set to quoted. Run the checks the add-capability skill names and
report what passed.
```

**Check:** the standard check. The new tests cover 10 percent allowed and 12 percent refused for desk, and 12 percent allowed for a supervisor.

## 4. Desk screens

**Goal:** the screens the desk uses during a call. **Skill:** `build-screens`.

```text
Use the build-screens skill. In showcase/examples/parts-desk, replace the default list and record
screens with these, written as custom TSX layouts from the starter's shadcn components (Card,
Badge, Button, Tabs, Table, Input, Separator, Tooltip, Kbd) and Tailwind classes:

- Inquiries, the first screen: open inquiries as dense rows with caller, utility, serial and
  subject, and a form to log a new call.
- Transformer: a header band with the serial in a monospace face, the utility, model, rating,
  voltage, substation and year in service. Below it, an exploded view of the transformer: one
  card per assembly (HV bushings, LV bushings, tap changer, tank cover, conservator, protection)
  laid out roughly where the assembly sits on the tank, each listing the parts that fit with
  stock and lead time. Then the transformer's quotes.
- Parts: a lookup with a search field, category tabs and an optional serial filter. Results are
  exploded-view cards grouped by assembly: a small inline SVG outline of the assembly (a bushing,
  a tap changer, a gasket ring, a relay) with the part's position marked, the part number in a
  monospace face, description, stock, lead time, unit price and an Add to quote button.
- Quote builder: lines with quantity steppers, unit and line totals on the left; on the right a
  summary card with utility, transformer, a discount field with the 10 percent limit marked on
  its track, the reason, the total, and Create draft, Submit and Cancel quote. Above 10 percent
  the field says that a supervisor must approve, in the warning color.

Style: use only the starter's color tokens (background, card, muted, accent, primary, success,
warning, destructive, border and their foregrounds), no literal colors. Stock badges are success
in stock, warning at three or fewer, destructive at none. Prices and quantities use tabular
numbers. Check every screen in light and dark. Keep it dense and work-like: no hero blocks, no
large display headings, no taglines.

Bind every operation that still has a headless exception, keep the UI-binding test passing, and
extend the Playwright spec: open TR-40417, add two HV bushings from the parts lookup to a quote,
set 8 percent, create the draft and submit it. Run the checks the build-screens skill names and
report what passed.
```

**Check:** the standard check and Playwright. Open `TR-40417` in the browser: you see the assembly cards with parts and stock badges.

## 5. Capability descriptions

**Goal:** descriptions a model can pick tools by. **Skill:** `add-capability`.

```text
Use the add-capability skill. In showcase/examples/parts-desk, rewrite the description of every
command and query, and of every input property, for a model that picks tools by description.
Each says what the capability does, when to call it, what it returns or changes and what it
refuses. transformer.find says it takes a serial as a caller reads it off the rating plate, whole
or partial, and that more than one match means asking the person which one. part.search says it
needs a serial for fitting parts. quote.discount says that above 10 percent an agent requests
approval instead. quote.cancel says it needs a reason. Keep each description under 400 characters.
Add a test that every capability and every input property of the application has a description.
Run the checks the add-capability skill names and report what passed.
```

**Check:** the standard check, including the new test that every capability and input property has a description.

## 6. Assistant agent

**Goal:** define the assistant and what it may do. **Skill:** `add-capability`.

```text
Use the add-capability skill. For the application in showcase/examples/parts-desk, run from the
repository root:

bun run scaffold add agent assistant --collection quote

Rewrite the generated agent as the desk's assistant, a direct agent. Its operations are every
query of the application, quote.create, quote.update, quote.discount and quote.submit. Its
requests are quote.discount and quote.cancel, so its grant adds approval.request and its
instructions list both commands with their input schemas. Model any; budgets of 12 turns, 30
tool calls and 300 seconds.

Write its instructions for the desk. It finds a transformer with transformer.find before anything
else, and asks the person when a serial matches no transformer or more than one. It never guesses
a part number or a price; it answers from the records and names the records it read. When a
person is at the screen, it prepares a quote with ui.prepare on quote.create, so the person checks
and creates it; it creates or submits a quote itself only when the person asks. It requests
approval for a discount above 10 percent and for every cancellation, with the caller's reason as
the rationale.

Keep the approval feature mount and the Approvals screen the scaffold added; desk members and
supervisors request and approve, and only supervisors reject. Replace the generated scenarios
with one in which the assistant creates a draft quote, and test that its grant holds
approval.request and not quote.cancel. Run the checks the add-capability skill names and report
what passed.
```

**Check:** the standard check. The grant test shows `approval.request` and no `quote.cancel`.

## 7. Local model

**Goal:** serve the assistant from a model on the desk's own machine. Tests use a stand-in for `llama-server`, so you need no weights until step 12. **Skill:** `serve-a-local-model`.

```text
Use the serve-a-local-model skill. In showcase/examples/parts-desk, serve the assistant from a
local model through the model server plugin on llama-server. Define the model entry
parts-desk-assistant for a GGUF base with 16384 context tokens, for the assistant only, and name
it on the agent with model local. Compose the site, network and process plugins if the
application lacks them, then the model server.

Extend dev.ts to write a deployment policy into a temporary directory and set
AGENT_NATIVE_SITE_POLICY unless it is already set. The policy binds local-inference to
http://127.0.0.1:4389 with a timeout of 300 seconds and the llm process to that port. By default
the process is the llama-server stand-in from @agent-native/model-server/testing with
showcase/examples/parts-desk/responder.ts as FIXTURE_RESPONDER. With LOCAL_MODEL_GGUF set, it is
llama-server (LLAMA_SERVER, or the one on PATH) on those weights, measured into the entry at
launch. Print which one runs.

responder.ts plays the assistant for a few requests from the conversation's messages: a serial
that matches one transformer calls transformer.find, then answers with it; a partial serial that
matches two asks the person with the ask_person tool and continues with the answer; "bushings"
calls part.search for HV bushings; a discount above 10 percent calls approval.request for
quote.discount. Anything else gets a short answer that it cannot help with that yet.

Test that a run started through POST /api/v1/runs with the assistant's agentId and no harnessId
runs on the model server's harness, and that the stand-in's run for TR-40417 calls
transformer.find. Run the checks the serve-a-local-model skill names and report what passed.
```

**Check:** the standard check. `bun run --cwd showcase/examples/parts-desk dev:web` prints which model server runs (the stand-in by default).

## 8. Assistant panel

**Goal:** the chat panel docked beside every screen. **Skill:** `build-screens`.

```text
Use the build-screens skill. In showcase/examples/parts-desk, add the assistant panel as the
aside of defineScreens, written as custom TSX from the starter's shadcn components and Tailwind
classes.

- Layout: docked at the right of every screen, resizable by dragging its left edge between 320
  and 640 pixels, and collapsible to a narrow rail with the assistant's icon. Remember the width
  in localStorage inside try/catch. On a compact viewport it opens as a full-height sheet from a
  button in the header.
- Turns: each message starts a run with POST /api/v1/runs, the assistant's agentId, the panel's
  UI session ID and, after the first, the conversationId of the first run. The local harness keeps
  no history between runs, so a follow-up's prompt includes the earlier turns as text. New
  conversation clears the panel. Read the runs with useRuns.
- Messages: the person's message right-aligned on primary, the assistant's text joined from the
  run's text events left-aligned on muted, with the time.
- Calls: each tool-start and tool-finish pair is a compact chip with the capability's title from
  the catalog, an icon for a query or a command, a spinner while it runs, a check in success when
  it finishes, and the refusal code in destructive when the host refuses it. Each record in the
  tool-finish resources of a command is a link that opens its screen. A query's finish names no
  records, so a transformer serial or quote number in the assistant's text is a link too.
- Questions: while the run awaits a question, a card shows it with a button per choice, or a text
  field when it offers none, and answers through POST /api/v1/runs/<id>/respond.
- Approvals: an approval.request call shows an approval card with the requested command's title,
  the input in words (such as 15 percent off Q-00003), the rationale and the request's state.
  A supervisor sees Approve and Reject; others see that a supervisor must decide. The browser
  has no role to read yet, so add a `member.current` query that returns the caller's role.
- Composer: a growing text area, Enter sends, Shift+Enter breaks the line, and a Stop button
  cancels the running run. Before the first message, show three example requests.

Style: only the starter's color tokens, light and dark, compact type, subtle borders, no
gradients or hero blocks. Add a Playwright spec against the stand-in model; the spec runs under
Node, so a Bun script prepares the workspace, the deployment policy and the model's environment.
The host refuses the first message while the model server is still starting, so the spec sends it again. Ask for
TR-40417 and see the transformer.find chip link to it; ask for TR-404 and answer the question
with TR-40471; ask for 15 percent off a draft and see the approval card. Run the checks the
build-screens skill names and report what passed.
```

**Check:** the standard check and Playwright. In the browser, ask "TR-404": the assistant asks which transformer you mean.

## 9. Screen context

**Goal:** "this transformer" means the one on the screen. **Skill:** `build-screens`.

```text
Use the build-screens skill. In showcase/examples/parts-desk, let each screen publish the record
it shows (inquiry, transformer, part or quote) and the person's selection to the assistant panel,
and let the panel send them through its UI session, so each run's context names them.

The panel sits beside the routes, so a screen's own UI session does not reach its runs: the screens hand their record to the panel through a small store, and the panel's session names it. The panel's header shows what the next run will see, such as "TR-40417 · Northgrid Energy", with
a control to leave it out. The composer offers up to three requests drawn from the screen, such
as "Which HV bushings fit TR-40417?" on a transformer, "Discount Q-00003 by 12 percent" on a
draft quote, and the inquiry's subject on an inquiry. Add a unit test of the requests for each
kind of record, and extend the Playwright spec: open TR-40417, see its requests, send one, and
check through GET /api/v1/runs that the run's UI context names the transformer. Run the checks
the build-screens skill names and report what passed.
```

**Check:** the standard check and Playwright. On `TR-40417`, the panel header shows `TR-40417 · Northgrid Energy` and suggests requests about it.

## 10. UI intents

**Goal:** the assistant opens screens and fills the quote form; the person creates the quote. **Skill:** `build-screens`.

```text
Use the build-screens skill. In showcase/examples/parts-desk, handle the assistant's UI intents
in the panel's UI session: open goes to the record's screen, select selects it, and prepare on
quote.create fills the quote builder through usePreparedInput. The builder shows a notice that
the assistant prepared the form, with Discard, and creates nothing until the person clicks
Create draft. The quote builder is a route of its own, so the panel passes a `prepare` handler that
navigates to it. Calls to ui.open and ui.prepare show as chips that say what opened or which form
they filled; a run's events name the call but not its input, so the handlers note what they received.
The panel narrows every screen, so lay the screens out by the width of the screen, not of the
window.

Extend responder.ts: "prepare a quote" for a serial and parts calls transformer.find, part.search
and ui.prepare on quote.create. Extend the Playwright spec: ask for a quote of two HV bushings for
TR-40417, see the builder open with the lines, create the draft and check that the person, not
the run, created the quote. Run the checks the build-screens skill names and report
what passed.
```

**Check:** the standard check and Playwright. Ask for a quote of two HV bushings for TR-40417: the quote builder opens filled in, and the app creates nothing until you click **Create draft**.

## 11. Scripted scenarios

**Goal:** tests that judge what the assistant committed and requested and which calls the policy refused, without a model. **Skill:** `add-capability`.

```text
Use the add-capability skill. In showcase/examples/parts-desk, write the assistant's scripted
scenarios with runAgentScenarios and the deterministic harness:

- A quote: the run finds TR-40417, searches its bushings, creates a draft quote with two of them
  and sets 5 percent. It commits the quote.
- A cancellation without approval: the run calls quote.cancel on a submitted quote and gets
  FORBIDDEN; nothing commits and the quote stays submitted.
- A cancellation with approval: the run requests approval for quote.cancel with a rationale. It
  commits nothing; a supervisor approves, and the cancellation runs as the supervisor.
- A discount above the limit: the policy refuses quote.discount at 15 percent and accepts
  approval.request for it.
- A clarifying question: for TR-404 the run asks which transformer and gets the answer TR-40471,
  then searches that transformer's parts. The scenario expects one question.

A scripted run cannot use a result and ends at its first refused call, so the discount on the
created quote takes the fixture's next record ID, and the refusal and the approval request of the
discount are two scenarios. Put them in test/agent-scenarios.test.ts. Run the checks the
add-capability skill names and report what passed.
```

**Check:** `bun test showcase/examples/parts-desk/test/agent-scenarios.test.ts` shows five passing scenarios.

## 12. Live run

**Goal:** one real conversation with a local model. **Skill:** `serve-a-local-model`.

```text
Use the serve-a-local-model skill. Start showcase/examples/parts-desk with bun run dev:web and
LOCAL_MODEL_GGUF set to the GGUF weights of an instruction model that calls tools. Through
Playwright, hold this conversation in the assistant panel, each message after the previous run
ends:

1. On the Inquiries screen: "A caller from Northgrid reads TR-404 off the plate. Which
   transformer is it?" Answer its question with TR-40471.
2. "Which HV bushings fit it, and are they in stock?"
3. "Prepare a quote for two of them."
4. Create the draft in the builder, then: "They want 15 percent off because of a late delivery."
5. "Cancel that quote, the utility found spares in its own store."

Report for each turn the calls with their outcomes, the questions, the approval requests, the
text and the time it took, and say where the model went wrong. Save a screenshot of the panel
after each turn. Add an opt-in test that holds turns 1 and 4 through the run route when
LOCAL_MODEL_GGUF is set and judges the receipts, not the text. Run the checks the
serve-a-local-model skill names and report what passed. Do not change prompts or code to make the
model succeed; record what it did in the README.
```

**Check:** the report lists each turn's calls, questions and approvals, with screenshots. A small model may fail some turns; the README records where. When the script drives the browser, open the launch link at once: it works once, for one minute.

## 13. Voice input

**Goal:** dictate into the composer; the person still sends. **Skill:** `build-screens`.

```text
Use the build-screens skill. In showcase/examples/parts-desk, add a microphone button to the
assistant composer. It uses the browser's speech recognition only with on-device processing, so
no audio leaves the machine, and it hides when the browser offers no on-device recognition for
English. While it listens, the button shows a pulsing ring in the primary color and the interim
words appear in the text area; the person edits and sends them. Extend the Playwright spec: the
button hides when the browser lacks on-device recognition, and with a stubbed recognizer the
dictated words fill the text area and the composer sends nothing. Say in the README where
dictation ran against a real microphone. Run the checks the build-screens skill names and
report what passed.
```

**Check:** the standard check and Playwright. Headless Chromium crashes on `SpeechRecognition.available()`, so the specs report recognition as unavailable.

## Limits

- The framework has no chat component. The panel is app code on the run route, run events and the UI session.
- Runs keep no history, so the panel sends earlier turns in each prompt. A reload starts a new conversation.
- A run keeps its last 256 events. A model asks questions only in a run started with a UI session.
