# Sign in at a shared lab bench

Several technicians share one terminal at the lab bench, and each request must record who submitted it. This pattern adds workstation sign-in to the [base lab desk](../base/README.md): a technician scans a badge and enters a PIN, and the bench screen then sends commands with an operator token, so the recorded requester and the authorization belong to that person, not the terminal. The token stays in memory and ends on sign-out, after two idle minutes or when the 15-minute session expires. The workspace stores only digests of badges and PINs.

```sh
cd showcase/patterns/sign-in
bun run dev:web
```

## What to try

- On **Badges** (port 4358), enroll `ana` (technician) and `ben` (viewer) with values such as `LAB-0042`; only the owner enrolls or revokes.
- On **Terminal**, scan a badge or type it as a burst with no field focused, or choose **Type instead**, then enter the PIN.
- Scan a sample label such as `OS-24-0417` to fill the sample field and submit as `ana`; `ben` can only read.

## References

- [Operator workstations: workstation sign-in](../../../docs/operator-workstations.md#workstation-sign-in)
- [sign-in-at-a-terminal](../../../workstations/sign-in/skills/sign-in-at-a-terminal/SKILL.md)
- `bun test showcase/patterns/sign-in`
