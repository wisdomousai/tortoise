# Documentation styleguide

Rules for prose in this repository: guides in `docs/`, the root README, `AGENTS.md`, package READMEs and skills. Nothing enforces the rules mechanically.

## Base style

The [Google developer documentation style guide](https://developers.google.com/style) is the base style for all prose in the repository. It governs voice, tone, word choice, grammar, punctuation, capitalization, lists, tables, code in text and link text wherever this styleguide is silent.

These departures from the Google guide take precedence over it:

- **Subject.** Sentences describe what the software does, with a component, file, command or role as the subject. The second person "you" appears only in procedures, as the implied subject of an imperative.
- **Dashes.** No em-dashes.
- **Terms.** The [glossary](glossary.md) overrides the Google word list for every term it defines.
- **Page shapes.** Guides, references, package READMEs, skills and the ledger keep the section orders under [Page types](#page-types).

## Voice

The subject of a sentence is a component, a file, a command, or a role the software names: operator, caller, principal, local owner.

- A page states what the software is and does. It does not name an audience, and it does not say why the page exists.
- A page never refers to itself. Delete "This page explains", "This guide covers" and "the sections below".
- Call the repository the repository or the project, never "this checkout".
- A procedure is a numbered list of imperatives: Run, Set, Open. The imperative names no addressee.
- Link a skill by name. Do not write "Coding agents follow".
- The root README's first paragraph states why the project exists. Every other paragraph follows these rules.

## Pronouns

- Repeat the subject when the last mention is two sentences back.
- they, them, and their take a plural noun as the subject of the same sentence. "The adapters reject sparse arrays."
- they, them, their, themselves, someone, and whoever do not refer to a person. Repeat the role.
- "Person" names a human principal, as distinct from an agent, a device, or the integration principal.

## Page types

Every page has one of the types below and keeps that type's section order. The root README is the site home. `AGENTS.md` holds the project instructions. Both keep the current sections.

### Guide

A guide in `docs/` explains one topic. Sections, in order, each present when it applies:

1. First paragraph: what the subject is and does, stated directly.
2. Concepts: optional. One line, `Terms:` followed by links to the [glossary](glossary.md) entries for the terms the page defines, with no definitions. Other terms link to the glossary at their first use in the text.
3. Mechanism: how the code does it, in the order a request or a record travels.
4. Use: the commands that apply the mechanism.
5. Limits: what the code does not do at all. A caveat about one mechanism stays with that mechanism.
6. References.

### Reference

A reference page is an index with a fixed entry shape and no narrative: the [glossary](glossary.md) and [primitives](primitives.md). The first paragraph says what the entries are. Every entry has the same parts in the same order, and entries are sorted by a stated rule.

### Package README

A README describes one package, plugin, app, example, pattern or SDK. "Package" on this page means any of the six. The first line is `# <package name>` from its `package.json`; `bun run check:readmes` enforces it. Sections, in order:

1. First paragraph: what the package is for, in two or three sentences.
2. Layer: which of framework, plugin, starter, content or SDK, and what the package trusts.
3. Primitives: the building blocks it implements, each linked to [primitives](primitives.md).
4. Entrypoints: a table of imports, where each runs and what it holds.
5. Trust boundary: what is checked, where, and what happens on failure.
6. Dependencies.
7. Tests: the command and one line per test file.
8. Skills: links, or one line saying why none apply.
9. References.

### Skill

A skill is a task guide. It keeps its frontmatter and these sections: a first paragraph, then "Before writing", "Steps" and "Checks". A "References" section may follow. These section names are fixed across skills. Steps are numbered, imperative and one action each. A skill links to the guide for the explanation instead of repeating it.

### Ledger

`implementation-status.md` records evidence that `bun run check` cannot produce: browser, device, live and by-hand runs. Each entry names its evidence kind, carries a date, and states what ran and what it showed. The ledger has no narrative and no design discussion.

## Sentences

- One idea per sentence. Target 20 words; 35 is the limit.
- At most one clause introduced by because, so, which, when, if, although or while. A sentence with two ", so" clauses is split.
- No em-dashes. One parenthetical per sentence at most, never nested.
- The subject is the component, file, command or role that acts. Pronouns follow [Pronouns](#pronouns).
- No fragments for emphasis. No sentence that ends in "or nothing"; say what fails instead.

Before:

> A command enqueues an effect on a changed resource. The effect commits with the domain change, receipt and journal entry, or not at all. Its ID derives from the receipt, so a replay never enqueues twice, and the SoR can use the ID for deduplication.

After:

> A command enqueues an effect on a resource it changed. The effect commits in the same transaction as the state change, the receipt and the journal entry. A replayed command returns its stored receipt and does not run the handler again, so it enqueues no second effect. The system of record can deduplicate on the effect ID, which stays the same across delivery attempts.

## Paragraphs

- The first sentence states the point. The rest support it.
- Five sentences at most.
- A paragraph explains one thing. Two topics are two paragraphs.
- Short sentences do not mean more words. A page states each fact once and does not restate the glossary. A rewrite that grows past the original by more than a third has added facts or repeated itself. The diff shows which.

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

- Every behavioral statement is true of the code on the branch. The statement names a handler, a port, a test or a check.
- Name the test file or the check that proves the statement.
- The status words `implemented`, `partial` and `proposed` appear as a status label only in [primitives](primitives.md), the [ledger](implementation-status.md) and a package README's Primitives section.
- The code is described in the present tense: write "the dispatcher retries" instead of "will retry". Planned work belongs in the ledger's gaps.

## Banned constructions

One fact per sentence: subject, verb, object. A condition is its own sentence. Replace a banned sentence with the behavior. Do not add a paragraph, and do not grow the page.

Delete:

- a sentence that starts with a number word and a noun such as choices, parts or layers, and list the items;
- a design said to have a number of parts, and use a heading or a list;
- a sentence that ends in a question mark, and state the fact;
- an aphorism, a slogan, or a sentence whose work is a contrast, and state what does the work;
- a scene or a motive, including "suits", "often", "proves nothing", "neither", and "looks enforced while it is ignored".

The exact phrases, matched without regard to case:

```text
shapes the design, in other words, put differently, note that, it is worth noting,
it is worth mentioning, importantly, crucially, the point is, simply, of course,
needless to say, at its core, at its heart, under the hood, battle-tested, seamless,
robust, powerful, elegant, leverage, delve, tapestry, journey, first-class,
out of the box, ", or nothing", never stands in for
```

## Code and commands

- Commands go in fenced `sh` blocks, one command per line. State the directory when it is not the repository root.
- A fenced block has a language tag.
- In guide prose, a code identifier such as a function, type or option appears only when the sentence points at that identifier. Use at most one per sentence and two per paragraph, and describe the rest in words.
- Paths and commands do not count as identifiers. READMEs and skills name identifiers freely in tables and steps.
- A file path is relative to the repository root unless the page says otherwise.
- A configuration fragment says which file it belongs in. A complete example lives in one place and is linked.

## Links and structure

- Each concept has one home page. Prose links a term where the term is used.
- A link to another page, guide, README or skill goes in the References section at the end of the page, one link per bullet, with nothing after the link. No sentence says what another page contains, covers, lists or explains.
- Links are relative Markdown links to files in the repository. A link to a source file or directory is turned into a GitHub link on the site.
- Every `docs/*.md` page is listed in the `guides` list of `docs/.vitepress/sidebar.ts`.
- Link text is the name of the page or the term. Do not use "here" or "this" as link text.

