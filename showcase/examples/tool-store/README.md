# Tool store

A plant's tool store lends torque wrenches, crimpers and testers to maintenance technicians against work orders. Attendants sign in at the shared counter terminal with a badge and PIN, scan the etched asset tag (`TC-` and five digits) and the borrower's badge, and check the tool out or back in. A tool returned damaged sends a repair order to the plant EAM through the outbox, and the EAM's feed keeps the tool master data current. A repair triage agent asks an attendant to approve retiring worn tools. Cycle counts check one bin at a time, and an agent moves the tools due for calibration to bin `CAL-01` over MCP. An in-memory fake stands in for the EAM.

```sh
cd showcase/examples/tool-store
bun run dev:web
```

## What to try

- Open **Badges** and enroll `E100001` with PIN `2468` for `mia@plant`. Open **Terminal**, type the badge and Enter with no field focused, and enter the PIN on the keypad.
- Add a tool on the counter, lend it, then return it as damaged. The tool shows the repair order number from the fake EAM.
- Start with `DEMO_EAM_UNKNOWN_TAGS=TC-00601` and return that tool as damaged. The EAM screen counts the refused repair order.
- Enroll a badge for `sam@plant`, a viewer, and sign in with it. The counter refuses the check-out.
- From the repository root, `bun run cli site check --site showcase/examples/tool-store/site-policy.store-terminal.json` checks the counter terminal's deployment policy.

## References

- [Tool store tutorial](../../../docs/tutorials/tool-store-1-records-and-screens.mdx)
- [Systems of record](../../../docs/systems-of-record.md)
- [Station sign-in](../../../workstations/sign-in/README.md)
- `bun test showcase/examples/tool-store`, `bunx playwright test showcase/examples/tool-store`
