---
name: use-application
description: Operate this application through its registered MCP capabilities, inspect scoped data, and apply authorized business commands. Use when asked to work in the connected application.
---

# Use the application

Read the `app://contract` MCP resource and discover current tools before acting. Identity and delegation come from the host; never supply roles or principals in tool arguments. Query the current object and revision before changing it.

Query tools take `{ "input": ... }`. Commands take `{ "input": ..., "idempotencyKey": "unique-request-id", "expectedRevisions": { "type:id": 1 } }`. Keep the same key and exact request when retrying after a lost response. A conflict requires a new query and deliberate reconciliation. A successful command receipt proves committed work; streamed agent text does not.

## project-planning

Create a project from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.

Tools: `project_create`, `task_create`, `task_list`, `task_set_status`.
