# 008 — Module size and cohesion

Accepted. Establishes [P14](../principles.md#p14--every-module-has-one-reason-to-change). Each module has one reason to change. Factories compose single-responsibility collaborators instead of holding every responsibility in one closure. Package barrels only re-export. `check:size` enforces limits that catch a module growing past one job.

**Context.** The code has few classes, but its god objects are factory closures and barrels. Measured over non-test sources, 26 files were over 300 lines and 74 functions over 80. The worst were `createApplication` (829 lines), `createProviderAccess`, `startHost`, the example handler lists and the station surfaces. In each, one exported function held every responsibility as inner functions over shared state, so reviewing a change meant reading the whole factory, and tests could reach a responsibility only through it.

**Decision.**

- **Keep the factory idiom.** An inner function becomes a module-level function that receives what it used to close over. Shared state goes in a small typed object passed in, for example `ControllerKernel` or `Writer`. Nothing is converted to classes.
- **Freeze the public surface.**
  - Packages export `./*`, so every file is a public subpath. An existing file stays where it is and becomes the entry module. Its internals move to a folder of the same name (`runtime/src/application/`, `host/src/providers/`).
  - Named exports and their types do not change.
  - Executable entries move out of barrels (`scaffold/src/cli.ts`).
- **Preserve behavior exactly.** Error messages, side-effect and `ctx.change` order, lazy evaluation, and sync throws versus rejections all stay as they were. Transaction and authorization comments move with their code. Existing tests are not edited; a split that needs a test change has changed behavior.
- **Preserve React state lifetime.** State moves into a hook that the owning component calls, never into a child that can unmount. That covers conditional forms, inactive tabs and editors closed by a live update. Extracted children are presentational.
- **Registry items.** A shadcn item in the hand-written frame registry is one file, so its components are decomposed within that file. Operator-ui items may span several files listed in `registry.manifest.ts`, and `build-operator-registry.ts` allows imports between files of the same item.
- **Check it.**
  - `scripts/check-size.ts` parses every workspace source with `@babel/parser`. It fails on a file over 300 lines, a function over 80, and any declaration in `packages/*/src/index.ts`.
  - Functions are measured on their own node, so a factory counts the inner functions it closes over.
  - The allowlist in `scripts/size-rules.ts` takes declarative tables only, each with a reason, and a stale entry fails.

**Consequences.**

- Reviewers read one responsibility per file, and the folder next to an entry module maps its parts.
- More files and more explicit parameters. Some calls pass a state object where a closure used to capture it.
- The limits are tripwires, not a design method. A split that follows line count instead of responsibility passes the check; P14 marks that as convention.
- Screen files that issue commands stay `.tsx`, because the UI-binding test (P1) reads only screen files. A hook that names an operation lives in a `.tsx` module.

**Alternatives considered.**

- Converting factories to classes: a larger diff, a different idiom from the rest of the code, and no gain in cohesion.
- Moving files to new paths: breaks the `./*` subpaths that applications import.
- Lint rules such as `max-lines`: the repository has no linter, and the boundary checks already parse sources in scripts.
