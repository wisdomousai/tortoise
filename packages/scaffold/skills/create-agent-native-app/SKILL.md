---
name: create-agent-native-app
description: Create an application with the scaffold or export a selected existing application. Use when starting a process-specific application, choosing its export mode, or routing further work to the appropriate task skill.
---

# Create an agent-native application

Use the scaffold to create an application in a new directory. The application defines the requested process; the framework supplies its execution infrastructure. Establish the process from the user's requirements before choosing records or screens. Hypothetical demonstration applications do not establish those requirements.

## Application design

Identify the event that starts the work and the records the application must retain. Determine who may perform each operation and what should happen when it cannot complete. Keep the application scoped to that process.

When an external system decides a write, establish its acceptance and recovery behavior and use a target. A local-only application does not require an external delivery path. Use the [integration skill](../../../integration/skills/connect-system-of-record/SKILL.md) for that connection.

Set `shelfLifeDays` according to the intended lifetime of a build; the scaffold initializes it to 180. Do not add an application ownership or renewal register. Provider credentials must come from an explicitly configured deployment.

## Creating the workspace

Run `scaffold new` from the framework checkout, following the [setup reference](references/new-application.md). The destination must not exist. Choose source export or a configured package registry according to how the application will receive framework changes. The registry route requires framework packages at the checkout's version.

Initialize Git in the exported directory and install its dependencies. Continue work from that directory. Preserve the scaffold markers when extending the generated application with `scaffold add`. Review every generated policy rule after renaming roles; later insertions still use the scaffold's `editor` rule.

A request to export a particular existing demonstration can use `scaffold --example <name>`. Treat its application behavior as source to inspect and adapt. The export does not establish that it meets the user's process requirements.

Choose the task skill for the next change from the exported application's `AGENTS.md`. Framework mechanisms are explained in [Architecture](../../../../docs/architecture.md). The [tutorials](../../../../docs/tutorials/index.md) document agent-led construction in their own hypothetical workspaces.

## Verification

Run the checks printed by the scaffold and the focused application tests after changing its behavior. Inspect the generated reference under `dist/reference` for the operations and external requirements the application declares. Follow [check-a-change](../../../testing/skills/check-a-change/SKILL.md) for repository checks and reporting their limits.

`bun install` links workspace skills for Claude Code and Codex. A registry application loads framework skills from its installed packages under `node_modules/@tortoise/`. Framework-source changes belong in the framework checkout.
