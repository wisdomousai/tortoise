# Documentation styleguide

Rules for prose in this repository: guides in `docs/`, the root README, `AGENTS.md`, package READMEs and skills. Coding agents follow them too. A reviewer applies them; nothing enforces them mechanically.

## Readers

The table assigns each page a reader. A page writes for that reader without naming them: it states what the software is and does, never who reads the page or why. A page never refers to itself: no "This page explains", "This guide covers" or "the sections below". Call the repository the repository or the project, never "this checkout", and give every "it" or "they" a clear subject.

| Reader | Wants | Pages |
| --- | --- | --- |
| Evaluator | Whether the framework fits a problem | Home, getting started, architecture |
| Integrator | How to connect a system, device or site | Systems of record, operator workstations, point-of-work input, hardware drivers, agents, hosting, security, plugin READMEs |
| Contributor | How a package works and how it is tested | Package READMEs, development and testing |
| Coding agent | The steps for one task | Skills, `AGENTS.md` |

## Page types

Every page has one of the types below and keeps that type's section order. A reader who knows the type knows where to look. The root README is the site home, and `AGENTS.md` holds the project instructions; both keep the sections they have.

### Guide

A guide in `docs/` explains one topic. Sections, in order, each present when it applies:

1. First paragraph: what the subject is and does, stated directly.
2. Concepts: optional. One line, `Terms:` followed by links to the [glossary](glossary.md) entries for the terms the page defines, with no definitions. Other terms link to the glossary at their first use in the text.
3. Mechanism: how the code does it, in the order a request or a record travels.
4. Use: what a reader does to apply it, with commands.
5. Limits: what the code does not do at all. A caveat about one mechanism stays with that mechanism.
6. Related pages.

### Reference

A reference page is an index with a fixed entry shape and no narrative: the [glossary](glossary.md) and [primitives](primitives.md). The first paragraph says what the entries are. Every entry has the same parts in the same order, and entries are sorted by a stated rule. This styleguide is a reference page of rules grouped by topic.

### Package README

A README describes one package, plugin, app, example or SDK. "Package" on this page means any of the five. The first line is `# <package name>` from its `package.json`; `bun run check:readmes` enforces it. Sections, in order:

1. First paragraph: what the package is for, in two or three sentences.
2. Layer: which of framework, plugin, starter, content or SDK, and what the package trusts.
3. Primitives: the building blocks it implements, each linked to [primitives](primitives.md).
4. Entrypoints: a table of imports, where each runs and what it holds.
5. Trust boundary: what is checked, where, and what happens on failure.
6. Dependencies.
7. Tests: the command and one line per test file.
8. Skills: links, or one line saying why none apply.

### Skill

A skill is a task guide for a coding agent. It keeps its frontmatter and these sections: a first paragraph, then "Before writing", "Steps" and "Checks". These section names are fixed across skills. Steps are numbered, imperative and one action each. A skill links to the guide for the explanation instead of repeating it.

### Ledger

`implementation-status.md` records evidence that `bun run check` cannot produce: browser, device, live and by-hand runs. Each entry names its evidence kind, carries a date, and states what ran and what it showed. The ledger has no narrative and no design discussion.

## Sentences

- One idea per sentence. Target 20 words; 35 is the limit.
- At most one clause introduced by because, so, which, when, if, although or while. A sentence with two ", so" clauses is split.
- No em-dashes. One parenthetical per sentence at most, never nested.
- The subject is the thing that acts: the dispatcher, the host, the command. Avoid "it" when the referent is two sentences back.
- No fragments for emphasis. No sentence that ends in "or nothing"; say what fails instead.

Before:

> A command enqueues an effect on a changed resource. The effect commits with the domain change, receipt and journal entry, or not at all. Its ID derives from the receipt, so a replay never enqueues twice, and the SoR can use the ID for deduplication.

After:

> A command enqueues an effect on a resource it changed. The effect commits in the same transaction as the state change, the receipt and the journal entry. A replayed command returns its stored receipt and does not run the handler again, so it enqueues no second effect. The system of record can deduplicate on the effect ID, which stays the same across delivery attempts.

## Paragraphs

- The first sentence states the point. The rest support it.
- Five sentences at most.
- A paragraph explains one thing. Two topics are two paragraphs.
- Short sentences do not mean more words. A page states each fact once and does not restate the glossary. A rewrite that grows past the original by more than a third has added facts or repeated itself; a reviewer checks which.

## Lists and tables

- Four or more items in one sentence become a list when the sentence is longer than 30 words. Four or five short nouns in a short sentence stay in the sentence.
- A list item is at most two sentences. In a definition list, each item starts with the term it defines, in bold.
- Items in a list are parallel: all nouns, all imperatives or all sentences.
- A table has at most four columns. A cell holds a phrase or one sentence of at most 20 words.
- Numbered lists are for sequences. Bulleted lists are for sets.

Before:

> The dispatcher claims queued, retrying and upstream effects, delivers each through the connector outside any transaction, retries a transient failure after backoff, and holds an effect when the target may have acted.

After:

> The dispatcher:
>
> 1. claims queued, retrying and upstream effects;
> 2. delivers each through the connector, outside any transaction;
> 3. retries a transient failure after backoff;
> 4. holds an effect when the target may have acted.

## Headings

- A heading is a noun phrase of at most six words, in sentence case: "Outbox and settlement", "Trust boundary", "Tests".
- A heading has no count, contrast, question, verb, slogan or subtitle after a colon or dash.
- A heading names the topic of the section below it and nothing else.
- Headings are unique on a page.
- Procedures are numbered lists under one heading. Headings carry no numbers.

Before:

> ## 1. Declarations
> ## How it fits together

After:

> ## Declarations
> ## Pages and entrypoints

## Terminology

- The [glossary](glossary.md) defines the terms. Use the canonical form on every page.
- A bare word on a glossary `Do not use:` line is wrong in every sense this repository uses. An entry with a qualifier in parentheses is wrong only in that sense.
- The first use of a term on a page links to its glossary entry or to the page that owns the concept.
- A code identifier is in backticks and does not replace the concept's name. Write "the dispatcher claims the effect" instead of "`claimEffect` runs".
- Abbreviations are written out on first use on a page, except the ones the glossary lists:
  - interfaces and protocols: CLI, MCP, API, UI, HTTP, SSE, TLS, mTLS, OIDC, PKCE, OPC UA, MQTT, OTLP;
  - data and identifiers: JSON, SQL, URL, ID, PIN, GS1;
  - systems: OS, SDK, ERP, MES, CRM, EAM, QMS, PLC, HMI, MDM.
- Protocol, file-format and product names keep their own form and capitalization. A term keeps the same capitalization everywhere.

## Claims

- Every behavioral statement is true of the code on the branch. A reviewer must be able to find it in a handler, a port, a test or a check.
- When a reader would want to verify, name the test file or the check that proves it.
- The status words `implemented`, `partial` and `proposed` appear as a status label only in [primitives](primitives.md), the [ledger](implementation-status.md) and a package README's Primitives section.
- The code is described in the present tense: write "the dispatcher retries" instead of "will retry". Planned work belongs in the ledger's gaps.

## Rhetoric

### Patterns to delete

| Pattern | Instead |
| --- | --- |
| Counting lead-in: a sentence that starts with a number word and a noun such as choices, parts or layers | List the items. |
| Enumerated model: a model, design or pattern said to have a number of parts | Use headings or a list. |
| Lead-ins, intensifiers and asides | Delete them. |
| Judgment words | Name the guarantee or delete. |
| Decorative words | Name the thing. |
| A sentence that ends in a question mark | State the answer. |

The exact phrases, matched without regard to case:

```text
shapes the design, in other words, put differently, note that, it is worth noting,
it is worth mentioning, importantly, crucially, the point is, simply, of course,
needless to say, at its core, at its heart, under the hood, battle-tested, seamless,
robust, powerful, elegant, leverage, delve, tapestry, journey, first-class,
out of the box, ", or nothing", never stands in for
```

### Reviewer patterns

A reviewer looks for these:

| Pattern | Instead |
| --- | --- |
| Aphorism | State the rule. |
| Contrast flourish | Say what does the work. |
| Compressed riddle | Say what the reader cannot conclude, and why. |
| Sales lede | Start with what the reader will do. |
| Paired absolutes, such as a never and an always in one sentence | State each rule on its own. |
| Slogan or tagline | Use a plain noun phrase. |

Before:

> Neither topology isolates anything by itself. The boundary is the container or user separation, the egress policy and the delegated grant that the deployment provides.

After:

> Neither the embedded nor the attached topology isolates the agent. Isolation comes from the deployment: a container or a separate OS user, the egress policy and the delegated grant.

Before:

> A lapsed claim proves nothing about the target.

After:

> A lapsed claim does not tell the new worker whether the target received the effect.

## Code and commands

- Commands go in fenced `sh` blocks, one command per line. State the directory when it is not the repository root.
- A fenced block has a language tag.
- In guide prose, a code identifier such as a function, type or option appears only when the reader has to go to it. Use at most one per sentence and two per paragraph, and describe the rest in words.
- Paths and commands do not count as identifiers. READMEs and skills name identifiers freely in tables and steps.
- A file path is relative to the repository root unless the page says otherwise.
- A configuration fragment says which file it belongs in. A complete example lives in one place and is linked.

## Links and structure

- Each concept has one home page. Other pages link to it in one sentence instead of re-explaining it.
- Links are relative Markdown links to files in the repository. A link to a source file or directory is turned into a GitHub link on the site.
- Every `docs/*.md` page is listed in the `guides` list of `docs/.vitepress/sidebar.ts`.
- Link text is the name of the page or the term. Do not use "here" or "this" as link text.

