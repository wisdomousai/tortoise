# Tool store

This hypothetical counter application records tool loans under the signed-in attendant's identity. The counter accepts configured scans and submits checkout or return commands. A damaged return records a repair-order request on the loan and enqueues delivery to the fake EAM.

The EAM's completion updates that loan's repair-order state. Its inbound sync changes the declared master-data fields while tool availability remains under the counter's commands. The application also declares repair-triage approval work and cycle-count assignments. The [tutorial](../../../docs/tutorials/tool-store-1-records-and-screens.mdx) documents its construction.

```sh
cd showcase/examples/tool-store
bun run dev:web
```

## What to try

Open **Badges** and enroll `E100001` with PIN `2468` for `mia@plant`. Open **Terminal**, type the badge and Enter with no field focused, and enter the PIN on the keypad.

Add a tool on the counter, lend it, then return it as damaged. The tool shows the repair order number from the fake EAM.

Start with `DEMO_EAM_UNKNOWN_TAGS=TC-00601` and return that tool as damaged. The EAM screen counts the refused repair order.

Enroll a badge for `sam@plant`, a viewer, and sign in with it. The counter refuses the check-out.

From the repository root, `bun run cli policy check --policy showcase/examples/tool-store/deployment-policy.store-terminal.json` checks the counter terminal's deployment policy.

## References

[Tool store tutorial](../../../docs/tutorials/tool-store-1-records-and-screens.mdx)

[Systems of record](../../../docs/systems-of-record.md)

[Station sign-in](../../../workstations/sign-in/README.md)

`bun test showcase/examples/tool-store`, `bunx playwright test showcase/examples/tool-store`
