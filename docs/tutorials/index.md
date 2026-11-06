# Tutorials

The tutorials use Claude Code or Codex to build applications. Each prompt changes the application in an exported repository. The explanation around it describes the implementation the reader needs to inspect and gives actions for checking the resulting behavior.

[Tool Store](tool-store-1-records-and-screens.mdx) teaches application construction through a counter application with an external maintenance-system connection. Work through its chapters in order in the same exported workspace.

[Parts Desk](parts-desk-1-records-and-quotes.mdx) develops an assistant for a quoting application. It assumes familiarity with the construction mechanics taught in Tool Store, but creates its own workspace. Its later chapters explain how the assistant interacts with the current screen. Real model execution is optional and has separate prerequisites.

## Starting a series

Complete [Getting started](../getting-started.md) if you have not used the scaffold. Install Bun and Git. Browser checks use Playwright's Chromium installation:

```sh
bunx playwright install chromium
```

Open the coding agent at the framework repository root for the export prompt. Use a destination outside that checkout which does not already exist. After export, open the agent at the new repository root. `bun install` links the task skills into that repository's agent discovery directories.

Each chapter requires the previous chapter's application state. Read the starting requirements before submitting a prompt. Inspect the agent's changes and run the stated checks before continuing. Keep a Git checkpoint after a verified step. A failed attempt may contain useful changes; inspect its diff before deciding how to repair it.

The exported repository contains only its selected application. Some skills retain links to omitted framework demonstrations, which can make the full skill check fail there. The chapters identify focused checks; report the full-check limitation separately.

## Reviewing the implementation

The code excerpts come from the finished reference applications committed in this repository. They show an implementation to inspect. A coding agent can organize the generated application differently, and later reference code can depend on a feature that the current step has not introduced. The chapter identifies those dependencies.

Source test filenames identify the finished reference implementation. The export commands run the application suite so they also work when the coding agent organizes its tests differently. Inspect the generated assertions for the required behavior.

Use the stated behavior to judge the result. An agent's report that tests passed does not establish the manual checks on the page. Run the relevant commands and inspect the observable state. The chapter's failure cases explain which operations must be refused or require recovery.

Screenshots show the reference application at the time of capture. The documentation build checks source imports and internal links. Application tests exercise their declared assertions. Neither check establishes that the generated interface matches a screenshot or that a real external system behaves like the tutorial's fixture.

## Scripted execution

`scripts/tutorial-run.ts` can execute a chapter with a locally configured Claude Code CLI. This helper invokes that CLI and may consume provider usage. It does not run Codex. Run the initial Tool Store chapter from the framework root:

```sh
bun scripts/tutorial-run.ts docs/tutorials/tool-store-1-records-and-screens.mdx --export /tmp/tool-store-walkthrough
```

The helper executes every prompt in the supplied chapter. It cannot skip the optional live-model prompt in Parts Desk chapter 4. Follow that chapter manually when continuing from the stand-in to the dictation step without a live model.

The initial export directory must not exist. Later invocations require the successful preceding checkpoint and a clean Git state in the same export. `--from` resumes after the recorded successful step. The runner refuses a different commit, and a failed attempt needs inspection before resuming.

Reports go into a timestamped directory under `artifacts/tutorial-runs/<application>/<chapter>/`. They retain the agent output and complete check output. The runner formats the export and executes its generic checks before recording a checkpoint. The chapter's manual acceptance checks still need to be run separately. A successful recorded walkthrough is evidence of that execution; coding-agent output can vary on another run.
