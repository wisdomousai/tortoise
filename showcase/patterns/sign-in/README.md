# Sign in at a shared lab bench

A technician scans a badge and enters a PIN at a shared terminal, then submits oil-test requests as that technician. A viewer can read the same requests but cannot submit them. The workspace owner enrolls and revokes the badges through [workstation sign-in](../../../docs/primitives.md#workstation-sign-in).

## Try the terminal

From the repository root:

```sh
cd showcase/patterns/sign-in
bun run dev:web
```

On **Badges**, enroll `ana` and `ben` with badge values such as `LAB-0042`. On **Terminal**, scan a badge, type it as a burst with no field focused, or choose **Type instead**, then enter its PIN. A sample label such as `OS-24-0417` fills the sample field. `ana` is a technician and `ben` is a viewer.

## Whose permission applies

The terminal's session can start sign-in; only the owner can enroll or revoke badges. After sign-in, [`ui/bench.tsx`](ui/bench.tsx) sends commands with the operator token, so the recorded requester and authorization belong to the signed-in person, not the terminal. The token stays in memory and ends on sign-out, after two idle minutes, when leaving the terminal screen or after the 15-minute session expires. The workspace stores badge and PIN digests.

## Checks

```sh
bun test showcase/patterns/sign-in
```

The sign-in test checks a technician, a viewer, replacement of a prior session, expiry and revocation over HTTP. See [operator workstations](../../../docs/operator-workstations.md#workstation-sign-in) for the shared-terminal design.
