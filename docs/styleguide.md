# Documentation styleguide

Write for developers building and operating Tortoise applications. Help a reader understand the purpose of a part, use it, and recognize its limits. Choose the structure the subject needs. No prescribed page template or word count.

Agents read this file, not personal settings, so every rule that matters is here.

## Page openings

- Start with what the subject is and what it is for. Give the context first: where the software runs, who uses it, and which systems it works with. Then describe the mechanism.
- Before any flow, name the parts the page relies on and say what each one does and why it is there. A request never goes to a part the page has not introduced.
- Make the software the subject of the first sentence. Do not open with "This page…" or "This reference lists…", and do not name the page's audience.

## Terms and links

- Introduce a term in the page's own words, in a clause that says what it does on this page, and link it to the [glossary](glossary.md) there. A glossary link does not replace that introduction. Do not copy the glossary entry or add a block of definitions.
- Link a term once per page, where the page introduces it. Do not link every noun.
- A workspace README links each primitive the workspace implements or shows to its entry in [primitives](primitives.md), where the README introduces it. The overview map on the documentation site lists a workspace's primitives from those links (`scripts/overview.ts`), so a glossary link in their place drops the primitive from the map.
- Give each word one meaning on a page. Write "target" for an integration and "destination" for its network access.
- Do not write a sentence whose subject is another page or a path and whose verb is explains, covers, lists, describes or has, such as "The systems-of-record guide explains…" or "The handlers are in…". Put links to other pages in a `## References` list at the end, one link per bullet. A path in parentheses after the behavior it implements is fine.

## Examples in a page

- The root README says what this repository is for: small applications at the edge that serve a specialized process, why Claude Code or Codex writes it as custom software, why that software is fragile when it starts from scratch, and what Tortoise gives it as a starting point at the edge. Leave each sample application in its own README.
- On any other page, an example shows that page's mechanism only.
- An example's README names the job in the domain's words, then what the application adds beyond the framework. Framework terms come after, where the README says how the application is built. Policy role names such as editor and viewer are not job titles.

## Sentences

- Name the actor and use an active verb: "the host writes the record", never "the record is written". When the actor is unknown, make the thing the subject or cut the sentence.
- Do not write "a coding agent writes…" or make an unnamed agent the actor for the reader's work. Name the tool (Claude Code, Codex) once, then use imperatives: paste, run, check.
- Do not write a version number for Bun or any other tool. `package.json` and the lockfile record versions; prose says "Bun".
- Keep a cause and its effect in one sentence when they belong together. Do not split every fact into its own sentence, and do not join clauses with semicolons.
- Keep a sentence when the reader would lose a fact, a step, a reason or needed context without it. Cut maxims, pitch, contrast slogans and sentences that repeat another one.
- Write headings as plain descriptive nouns, such as "Setup", "Failure behavior" or "Running the example". Do not write "From notice to decision", "Try the plant stand-in", a number-led heading or a contrast slogan.
- Use headings, lists, bold labels and tables when they help a reader find or compare information. Use numbered steps for a sequence, and code blocks with a language tag for commands and examples.

## Plain words

Names, capability IDs, UI copy and prose use the word the industry or plain engineering uses for the thing. Do not use these coined metaphors in names or prose:

```text
settle, settlement, land, lands, landed, landing, arrive, arrives, arrived, arrival,
lane, seat, travels, rides, mint, mints, minted, on the same footing,
hold, holds, holding, carry, carries, carrying, carried
```

Do not use these filler words:

```text
seamless, robust, powerful, elegant, leverage, delve, first-class, battle-tested,
out of the box, under the hood, at its core, simply, of course, note that, importantly
```

- A person answers a question. A system returns, responds, handles or implements.
- The glossary's `Do not use:` lines list retired terms, such as working set, gated actuator and peer surface.

## Claims and evidence

- Check behavior, commands, paths and examples against the current implementation. Name a relevant source or test when it helps a reader verify a technical claim.
- State the trust boundary and the failure behavior next to the operation they affect.
- Put what was not run live, such as a browser, device, provider or real system of record, in one limits section of the page, not as a caveat on every step. Keep dated observations as historical evidence, and change a known gap only when current evidence supports it.
- Do not present a local commit or a transport acknowledgement as an external system's acceptance. Describe planned or partial behavior as such.

## Kinds of page

- **Guides** explain how a mechanism fits the application flow and how to use it. Tutorials give a reproducible sequence with prerequisites and checks at each step.
- **READMEs** introduce the workspace and give the details needed to use or change it. A framework package's or plugin's README opens with what it supplies to every application, so no application writes it. Include entrypoints, dependencies, trust, failure behavior and test commands where useful. Section names and order are the author's choice.
- **Skills** are operational guides for a task. Preserve their frontmatter and keep instructions, paths and checks valid. Link to deeper explanations rather than copying them, and distinguish a deterministic check from live evidence.
- **References** make definitions or facts easy to find. The [implementation status](implementation-status.md) records dated evidence and known gaps that automated checks cannot establish.

Use relative links to repository files. Put commands in the directory where they work, or say which directory to use. Say which file a configuration fragment belongs in, and link to a complete example when one exists. Add a new guide page to a group in `docs/site/sidebar.ts`.
