# Sign in at a shared lab bench

This pattern composes workstation sign-in with the hypothetical [base application](../base/README.md). The terminal exchanges a badge and PIN for an operator session. Request commands use that session so their authorization and recorded requester belong to the signed-in person.

The workspace stores credential digests. The terminal UI clears its operator session on sign-out and after its configured idle period. Host-side expiry still applies to subsequent requests.

```sh
cd showcase/patterns/sign-in
bun run dev:web
```

## What to try

On **Badges** (port 4358), enroll `ana` (technician) and `ben` (viewer) with values such as `LAB-0042`; only the local user enrolls or revokes.

On **Terminal**, scan a badge or type it as a burst with no field focused, or choose **Type instead**, then enter the PIN.

Scan a sample label such as `OS-24-0417` to fill the sample field and submit as `ana`; `ben` can only read.

## References

[Operator workstations: workstation sign-in](../../../docs/operator-workstations.md#workstation-sign-in)

[sign-in-at-a-terminal](../../../workstations/sign-in/skills/sign-in-at-a-terminal/SKILL.md)

`bun test showcase/patterns/sign-in`
