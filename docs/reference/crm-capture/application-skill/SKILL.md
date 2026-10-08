---
name: use-application
description: Operate this application through its registered MCP capabilities, inspect scoped data, and apply authorized business commands. Use when asked to work in the connected application.
---

# Use the application

Read the `app://contract` MCP resource and discover current tools before acting. Identity and delegation come from the host; never supply roles or principals in tool arguments. Query the current object and revision before changing it.

Query tools take `{ "input": ... }`. Commands take `{ "input": ..., "idempotencyKey": "unique-request-id", "expectedRevisions": { "type:id": 1 } }`. Keep the same key and exact request when retrying after a lost response. A conflict requires a new query and deliberate reconciliation. A successful command receipt proves committed work; streamed agent text does not.

## From a shell

The same operations are subcommands of the `agent-native-desktop-starter` binary. Run `agent-native-desktop-starter help` and `agent-native-desktop-starter help <command>` for generated flags; `help`, `schema` and `workflows` work without an authority. Add `--embedded --workspace <dir>` to run in-process in a sandbox, or attach to a running authority with `--connection <file>`; your identity comes from that file or the launcher's grant file, never from flags. Pass `--key <id>` on commands and reuse it when retrying, `--dry-run` to validate first, and `--output text` for tables. Branch on the exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict, 6 idempotency conflict, 7 cancelled, 8 unavailable (for example the audit log in fail-closed mode). Before a sandbox is discarded, `agent-native-desktop-starter drain` must exit 0; 75 means captured work has not reached the system of record yet.

## find-and-log

Find the account with crm.account.search (or a contact with crm.contact.search, then its accountId). Results come live from the CRM and are not stored. Adopt the account with crm.account.adopt unless local already says following or adopted, then log the activity against it with crm.activity.log using the time from the source. If source.status is unavailable, use crm.account.list for accounts already adopted and say the CRM could not be searched; never invent CRM IDs.

Tools: `crm_account_search`, `crm_contact_search`, `crm_account_lookup`, `crm_account_adopt`, `crm_account_get`, `crm_activity_log`.

CLI: `agent-native-desktop-starter crm account search`, `agent-native-desktop-starter crm contact search`, `agent-native-desktop-starter crm account lookup`, `agent-native-desktop-starter crm account adopt`, `agent-native-desktop-starter crm account get`, `agent-native-desktop-starter crm activity log`.

## review-security-posture

Start with the posture. For any check that is not passing, list the matching audit events (for example kinds egress.denied, command.denied or posture.checked) and verify the chain before drawing conclusions. Report destinations by ID and state; never infer that an unbound destination was reached.

Tools: `assurance_posture_get`, `assurance_events_list`, `assurance_log_verify`.

CLI: `agent-native-desktop-starter assurance posture get`, `agent-native-desktop-starter assurance events list`, `agent-native-desktop-starter assurance log verify`.

## review-sync

Read crm.sync.status, then list rejected accounts and open activities that were not accepted. Explain each rejection; do not retry by logging the same activity again.

Tools: `crm_sync_status`, `crm_account_list`, `crm_account_get`.

CLI: `agent-native-desktop-starter crm sync status`, `agent-native-desktop-starter crm account list`, `agent-native-desktop-starter crm account get`.
