# 008 — Module size and cohesion

Accepted. Serves [P14](../principles.md#p14--one-reason-to-change-per-module).

**Context.** The code has few classes. Its god objects were factory closures and barrels: one exported function held every responsibility as inner functions over shared state. Reviewing a change meant reading the whole factory, and tests could reach a responsibility only through it.

**Decision.**

- **Keep the factory idiom, split by responsibility.** An inner function becomes a module-level function that receives what it used to close over. Shared state goes in a small typed object passed in explicitly. Nothing is converted to classes.
- **Keep public paths stable.** Every package file is a public subpath, so a file being split stays where it is as the entry module, and its internals move to a folder of the same name.
- **Keep behavior identical when splitting.** That covers errors, ordering and laziness. A split that needs a test change has changed behavior.
- **Keep React state with its owner.** State moves into a hook the owning component calls, never into a child that can unmount.
- **Use a size check as a tripwire.** A script flags oversized files and functions and barrels that contain code. Declarative tables may be exempted, each with a reason.

**Consequences.**

- More files and more explicit parameters, and each file has one job.
- The limits catch growth. They are not a design method: a split by line count passes the check, so the quality of a split is left to review.

**Alternatives considered.**

- Classes: a larger diff and a different idiom, with no gain in cohesion.
- Moving files: breaks import paths that applications use.
- A lint rule: the repository has no linter, and its checks already parse sources.
