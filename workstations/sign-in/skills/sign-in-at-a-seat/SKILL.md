---
name: sign-in-at-a-seat
description: Let operators sign in at a shared workstation seat with a badge and PIN and work as themselves, with the seat screen, the badge screen and an operator session in the browser. Use when people share a bench, terminal or line station and each must act under their own permissions, when composing the station sign-in plugin and its screens, when writing the screen a signed-in operator works on, or when enrolling and revoking badges. Covers workstations/sign-in and the numeric pad's PIN mode in packages/operator-ui.
---

# Sign in at a seat

A [seat](../../../../docs/glossary.md#seat) is a principal whose screen may sign people in. An [operator](../../../../docs/glossary.md#operator) scans a badge there and enters a PIN. The seat's screen then holds a short-lived operator token in memory and acts as that person until the session ends.

## Before writing

- Decide which principals are seats. The local owner always is. A tablet's principal is listed in `station-sign-in-seats`.
- Decide how long a session lasts (`station-sign-in-minutes`, 15 by default) and how long the seat may sit idle before it signs the operator out (`idleMs`, two minutes by default).
- Make every person who signs in a member under the application's policy, with the role their work needs. The operator acts with their own permissions, never the seat's.
- Write the badge format as a regular expression. A scan that does not match it shows "Not a badge".
- `patterns/sign-in` composes the plugin and its screens at a lab bench, with a technician and a viewer.

## Steps

1. Add `stationSignInPluginManifest` from `@agent-native/workstation-sign-in/plugin-manifest` to the manifest's `plugins`.
2. Add `createStationSignInPlugin()` from `@agent-native/workstation-sign-in/plugin` to the application's `plugins`.
3. Write the screen an operator works on as a component without props. Read the operator's `client` and `live` bindings with `useOperatorSession()` from `@agent-native/workstation-sign-in/plugin-screens`.
4. Use only that client in this component, never `@/lib/session`, which acts as the seat. Frame components such as `collection-screen` read `@/lib/session`, so the work component uses its own hooks.
5. Pass `stationSignInScreens({ seat, work, idleMs, badgePattern })` to `defineScreens({ plugins })`, with the application's `manifest`. The seat screen is at `/seat` and the badge screen at `/badges`.
6. Enroll badges on the badge screen as the local owner, who is the plugin's admin. Enrollment posts to `stationPaths.enroll`, which hashes the PIN, so neither the badge value nor the PIN becomes a stored command input.

For a PIN entry of your own, pass `code` and `masked` to the operator registry's `numeric-pad`. `code` keeps leading zeros and offers no separator. `masked` shows a dot per digit. `onSubmit` gets the entry as typed as its second argument.

## Checks

1. Test over HTTP with `startHost`. Use the connection file's token as the seat.
2. Enroll through `stationPaths.enroll` and sign in through `stationPaths.signIn`. Then call the application's operations with the returned token as a bearer.
3. Cover these cases:
   - the operator's work recorded as the operator;
   - a role the policy refuses;
   - the next sign-in at the same seat ending the previous session;
   - an expiry, with the plugin's `now` option;
   - a revoked badge.
4. List the plugin's screens directory, `workstations/sign-in/src`, among the roots of the application's UI binding test.
5. Run the tests:

   ```sh
   bun test workstations/sign-in patterns/sign-in
   ```

6. Run the seat by hand with `bun run dev:web` and a keyboard-wedge scanner, or by typing the badge as a burst with no field focused. Record the run in [implementation status](../../../../docs/implementation-status.md).
7. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.

## References

- [`@agent-native/workstation-sign-in`](../../README.md)
- [Operator workstations: workstation sign-in](../../../../docs/operator-workstations.md#workstation-sign-in)
- [Sign-in pattern](../../../../patterns/sign-in/README.md)
- [`@agent-native/operator-ui`](../../../../packages/operator-ui/README.md)
