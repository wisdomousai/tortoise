---
name: use-application
description: Operate this application through its registered MCP capabilities, inspect scoped data, and apply authorized business commands. Use when asked to work in the connected application.
---

# Use the application

Read the `app://contract` MCP resource and discover current tools before acting. Identity and delegation come from the host; never supply roles or principals in tool arguments. Query the current object and revision before changing it.

Query tools take `{ "input": ... }`. Commands take `{ "input": ..., "idempotencyKey": "unique-request-id", "expectedRevisions": { "type:id": 1 } }`. Keep the same key and exact request when retrying after a lost response. A conflict requires a new query and deliberate reconciliation. A successful command receipt proves committed work; streamed agent text does not.

## From a shell

The same operations are subcommands of the `agent-native-desktop-starter` binary. Run `agent-native-desktop-starter help` and `agent-native-desktop-starter help <command>` for generated flags; `help`, `schema` and `workflows` work without an authority. Add `--embedded --workspace <dir>` to run in-process in a sandbox, or attach to a running authority with `--connection <file>`; your identity comes from that file or the launcher's grant file, never from flags. Pass `--key <id>` on commands and reuse it when retrying, `--dry-run` to validate first, and `--output text` for tables. Branch on the exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict, 6 idempotency conflict, 7 cancelled, 8 unavailable (for example the audit log in fail-closed mode). Before a sandbox is discarded, `agent-native-desktop-starter drain` must exit 0; 75 means captured work has not reached the system of record yet.

## configure-scanner

Read the station configuration first. Save a scanner profile only from values the user confirmed or a calibration produced; never guess prefixes, suffixes or layouts. Keep specific scan routes before general ones and test a pattern against an example code the user supplies.

Tools: `device_config_get`, `device_scanner_save`, `device_routes_save`.

CLI: `agent-native-desktop-starter device config get`, `agent-native-desktop-starter device scanner save`, `agent-native-desktop-starter device routes save`.

## explain-stop

Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and propose the reason that the alarm and history support, with your evidence. Classify only after the operator confirms the reason; never classify a stop from a guess. If no reason fits, say so.

Tools: `line_stop_list`, `line_station_get`, `line_reason_list`, `line_stop_classify`.

CLI: `agent-native-desktop-starter line stop list`, `agent-native-desktop-starter line station get`, `agent-native-desktop-starter line reason list`, `agent-native-desktop-starter line stop classify`.

## inspect-lot

Find the open lot, read its characteristics and limits, then record each measurement for the sample named by the worklist. For an instrument export, map rows to characteristics and samples and submit them with record-batch in one commit; never invent values that are not in the source. Use the measurement time from the source as occurredAt. Report out-of-tolerance results and record a defect only when the source states one. Leave the usage decision to a supervisor.

Tools: `inspection_lot_list`, `inspection_worklist`, `inspection_lot_get`, `inspection_result_record_batch`, `inspection_result_record`, `inspection_defect_record`.

CLI: `agent-native-desktop-starter inspection lot list`, `agent-native-desktop-starter inspection worklist`, `agent-native-desktop-starter inspection lot get`, `agent-native-desktop-starter inspection result record-batch`, `agent-native-desktop-starter inspection result record`, `agent-native-desktop-starter inspection defect record`.

## project-planning

Create a project from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.

Tools: `project_create`, `task_create`, `task_list`, `task_set_status`.

CLI: `agent-native-desktop-starter project create`, `agent-native-desktop-starter task create`, `agent-native-desktop-starter task list`, `agent-native-desktop-starter task set-status`.

## shift-handover

Summarize each station for the next shift: active order and counters with their freshness and source, stops and their classification, open attention items and held screen procedures, and records the MES rejected. Report observed values as observed (with time and confidence), not as facts.

Tools: `line_station_list`, `line_station_get`, `line_stop_list`, `line_attention_list`, `line_sync_status`.

CLI: `agent-native-desktop-starter line station list`, `agent-native-desktop-starter line station get`, `agent-native-desktop-starter line stop list`, `agent-native-desktop-starter line attention list`, `agent-native-desktop-starter line sync status`.

## triage-rejections

Read rejected records from sync status, inspect the lot and the rejection reason, and explain each one. Correct a result only when the reason identifies a clear entry error and the correct value is known; supply that reason. Otherwise ask the user. A correction is forwarded again and may itself be rejected.

Tools: `inspection_sync_status`, `inspection_lot_get`, `inspection_result_correct`.

CLI: `agent-native-desktop-starter inspection sync status`, `agent-native-desktop-starter inspection lot get`, `agent-native-desktop-starter inspection result correct`.
