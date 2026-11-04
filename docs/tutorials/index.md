# Tutorials

Each tutorial builds one whole application for a transformer plant with Claude Code or Codex, one prompt per step. A step names the skill the prompt uses, explains the framework part it touches, gives the prompt to paste, shows what the finished example contains, and ends with a check. The finished applications are committed as examples, so every excerpt and screenshot on these pages comes from code that `bun run check` tests.

| Tutorial                                             | Application                                                                                                                                                                                                        | Steps | Skills                                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Tool store](tool-store-1-records-and-screens.mdx)   | The plant tool store: attendants lend tools to employees and take them back, a counter terminal with a scanner and badge sign-in, repair orders to the plant's EAM, a triage agent, cycle counts, a deployment policy. | 14    | create-agent-native-app, add-capability, build-screens, write-a-feature, add-scanner-input, sign-in-at-a-terminal, connect-system-of-record, assign-work, deploy-an-application, decommission-an-application |
| [Parts desk](parts-desk-1-records-and-quotes.mdx)    | The spare parts desk: transformers, parts and quotes, and an assistant panel beside every screen that runs on a local model, fills forms for the person to check and asks for approval.                             | 13    | create-agent-native-app, add-capability, build-screens, serve-a-local-model                                                                                                                         |

[Getting started](../getting-started.md) comes first: it builds a small application by hand, so the prompts here read as familiar steps.

## Prerequisites

- Bun, Git and the browser for Playwright: `bunx playwright install chromium`.
- Claude Code or Codex. The prompts name the skill to use; `bun install` links the skills into `.claude/skills/` and `.agents/skills/` of the repository the agent works in.
- For the parts desk's live run only: llama.cpp's `llama-server` and a GGUF instruction model that calls tools.

## Working through a tutorial

1. Open Claude Code or Codex at the root of this repository for the first step. From the second step on, open it at the root of the exported application.
2. Paste the prompt, wait for the report, run the check and commit. One commit per step lets a failed step start over with `git reset --hard HEAD`.
3. Compare the result with the excerpts on the page. An agent writes each step differently each time, so names, file splits and tests differ in detail from the committed example while the check passes.

The export leaves out the other examples, so `bun run check:skills` fails there on links to them. The pages name the checks to run instead.

The finished applications start from the repository without the prompts:

```sh
bun run --cwd showcase/examples/tool-store dev:web
bun run --cwd showcase/examples/parts-desk dev:web
```

`bun run scaffold /tmp/my-store --name my-store --example tool-store` exports one of them as the start of an application.

## References

- [Tool store 1: records and screens](tool-store-1-records-and-screens.mdx)
- [Tool store 2: counter terminal](tool-store-2-counter-terminal.mdx)
- [Tool store 3: connections and agents](tool-store-3-connections-and-agents.mdx)
- [Tool store 4: deployment](tool-store-4-deployment.mdx)
- [Parts desk 1: records and quotes](parts-desk-1-records-and-quotes.mdx)
- [Parts desk 2: assistant](parts-desk-2-assistant.mdx)
- [Parts desk 3: context and scenarios](parts-desk-3-context-and-scenarios.mdx)
- [Parts desk 4: live model and voice](parts-desk-4-live-model-and-voice.mdx)
- [Skills](../../AGENTS.md#skills)
