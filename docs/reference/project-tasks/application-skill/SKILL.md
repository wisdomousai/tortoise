---
name: use-application
description: Operate this application through its registered MCP capabilities, inspect scoped data, and apply authorized business commands. Use when asked to work in the connected application.
---

# Use the application

Read the `app://contract` MCP resource and discover current tools before acting. Identity and delegation come from the host; never supply roles or principals in tool arguments. Query the current object and revision before changing it.

Query tools take `{ "input": ... }`. Commands take `{ "input": ..., "idempotencyKey": "unique-request-id", "expectedRevisions": { "type:id": 1 } }`. Keep the same key and exact request when retrying after a lost response. A conflict requires a new query and deliberate reconciliation. A successful command receipt proves committed work; streamed agent text does not.

## From a shell

The same operations are subcommands of the `agent-native-desktop-starter` binary. Run `agent-native-desktop-starter help` and `agent-native-desktop-starter help <command>` for generated flags; `help`, `schema` and `workflows` work without an authority. Add `--embedded --workspace <dir>` to run in-process in a sandbox, or attach to a running authority with `--connection <file>`; your identity comes from that file or the launcher's grant file, never from flags. Pass `--key <id>` on commands and reuse it when retrying, `--dry-run` to validate first, and `--output text` for tables. Branch on the exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict, 6 idempotency conflict, 7 cancelled. Before a sandbox is discarded, `agent-native-desktop-starter drain` must exit 0; 75 means captured work has not reached the system of record yet.

## project-planning

Create a project from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.

Tools: `project_create`, `task_create`, `task_list`, `task_set_status`.

CLI: `agent-native-desktop-starter project create`, `agent-native-desktop-starter task create`, `agent-native-desktop-starter task list`, `agent-native-desktop-starter task set-status`.
