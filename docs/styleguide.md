# Documentation styleguide

Write for developers building and operating Tortoise applications. Help a reader understand the purpose of a part, use it, and recognize its limits. Choose the structure the subject needs; this guide does not prescribe a page template or a word count.

## Explain the work

- Start with what the page or component is for. Give enough context for someone entering the page directly, and link to related material instead of repeating it.
- Use a concrete example when it makes a flow clearer. Show what triggers the work, where a record is committed, what happens next, and who decides the outcome when those details matter.
- Explain unfamiliar terms where they become useful. Use the [glossary](glossary.md) for consistent meanings and link to a fuller explanation when appropriate.
- Prefer plain words, active sentences and specific subjects. Vary sentence length as needed to connect an action with its result.
- Use headings, lists, bold labels and tables when they help a reader find or compare information. Use numbered steps for a sequence, and code blocks with a language tag for commands and examples.

## Support claims

- Check behavior, commands, paths and examples against the current implementation. Name a relevant source or test when it helps a reader verify a technical claim.
- Separate deterministic test results from browser, native, live-provider, hardware and by-hand evidence. Keep dated observations as historical evidence; change a known gap only when current evidence supports it.
- State the applicable trust boundary, failure behavior, prerequisites and limits next to the operation they affect. Do not present a local commit or a transport acknowledgement as an external system's acceptance.
- Describe planned or partial behavior as such. Do not imply a deployment, live integration or release ran merely because a build or test passed.

## Choose the material

- **Guides** explain how a mechanism fits the application flow and how to use it. Tutorials provide a reproducible sequence with prerequisites and checks.
- **READMEs** introduce the workspace and give the details needed to use or change it. Include entrypoints, dependencies, trust, failure behavior and test commands where useful; section names and order are up to the author.
- **Skills** are operational guides for a task. Preserve their frontmatter and keep instructions, paths and checks valid. Link to deeper explanations rather than duplicating them, and distinguish a deterministic check from live evidence.
- **References** make definitions or facts easy to find. The [implementation status](implementation-status.md) records dated evidence and known gaps that automated checks cannot establish.

Use relative links to repository files. Put commands in the directory where they work, or say which directory to use. Document a configuration fragment's destination and link to a complete example when available. Add new guide pages to `docs/.vitepress/sidebar.ts`.
