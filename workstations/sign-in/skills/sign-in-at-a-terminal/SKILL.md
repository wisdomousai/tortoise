---
name: sign-in-at-a-terminal
description: Let operators sign in at a shared workstation terminal with a badge and PIN and work as themselves, with the terminal screen, the badge screen and an operator session in the browser. Use when people share a bench, terminal or line station and each must act under their own permissions, when composing the station sign-in plugin and its screens, when writing the screen a signed-in operator works on, or when enrolling and revoking badges. Covers workstations/sign-in and the numeric pad's PIN mode in packages/operator-ui.
---

# Sign in at a terminal

A terminal is a principal whose screen may sign people in. An operator scans a badge there and enters a PIN. The terminal's screen then stores a short-lived operator token in the tab's session storage and acts as that person until the session ends. After a reload it asks `POST /api/v1/station/session` for the open session that token names at the same terminal; an ended session returns it to sign-in. A sign-out or the session's expiry also stops a request still running as the operator.

## Before writing

- Decide which principals are terminals. The local owner always is. A tablet's principal is listed in `station-sign-in-terminals`.
- Decide how long a session lasts (`station-sign-in-minutes`, 15 by default) and how long the terminal may sit idle before it signs the operator out (`idleMs`, two minutes by default).
- Make every person who signs in a member under the application's policy, with the role their work needs. The operator acts with their own permissions, never the terminal's. A scaffolded application sets members only when its workspace is created, so give the application a default member list, as `benchMembers` does in the sign-in pattern. For an existing workspace, use a new development workspace or migrate its members; preserve any data needed from the original.
- A badge value that is also a business identifier, such as an employee number stored on a record, is no secret, so the PIN and the lockout are the secret parts of sign-in.
- Write the badge format as a regular expression. A scan that does not match it shows "Not a badge".
- `showcase/patterns/sign-in` composes the plugin and its screens at a lab bench, with a technician and a viewer.

## Steps

1. Add `stationSignInPluginManifest` from `@tortoise/workstation-sign-in/plugin-manifest` to the manifest's `plugins`.
2. Add `createStationSignInPlugin()` from `@tortoise/workstation-sign-in/plugin` to the application's `plugins`.
3. Write the screen an operator works on as a component without props. It is mounted at `/terminal` alone, and leaving that route ends the session, so several views behind sign-in are tabs inside the component, not routes. Read the operator's `client` and `live` bindings with `useOperatorSession()` from `@tortoise/workstation-sign-in/plugin-screens`.
4. Use only that client in this component, never `@/lib/session`, which acts as the terminal. Frame components such as `collection-screen` and `CapabilityForm` read `@/lib/session`, so the work component uses its own hooks and forms that send through the operator client's `transport`. `useUiSession`, `Accounts` and `RunPanel` call the host with the terminal's session instead: a run started in the work component acts as the terminal's principal, and the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`) covers handling its intents without leaving the terminal. An application-wide scanner listener must stop on `/terminal`, or it reads the badge burst too.
5. Pass `stationSignInScreens({ terminal, work, idleMs, badgePattern })` to `defineScreens({ plugins })`, with the application's `manifest`. The terminal screen is at `/terminal` and the badge screen at `/badges`.
6. Enroll badges on the badge screen as the local owner, who is the plugin's admin. Enrollment posts to `stationPaths.enroll`, which hashes the PIN, so neither the badge value nor the PIN becomes a stored command input.

For a PIN entry of your own, pass `code` and `masked` to the operator registry's `numeric-pad`. `code` keeps leading zeros and offers no separator. `masked` shows a dot per digit. `onSubmit` gets the entry as typed as its second argument.

## Checks

1. Test over HTTP with `startHost`. Use the connection file's token as the terminal.
2. Enroll through `stationPaths.enroll` and sign in through `stationPaths.signIn`. Then call the application's operations with the returned token as a bearer.
3. Cover these cases:
   - the operator's work recorded as the operator;
   - a role the policy refuses;
   - the next sign-in at the same terminal ending the previous session;
   - an expiry, with the plugin's `now` option;
   - a revoked badge.
4. List the plugin's screens directory, `workstations/sign-in/src`, among the roots of the application's UI binding test.
5. Run the tests:

   ```sh
   bun test workstations/sign-in showcase/examples/<app>
   ```

6. Run the terminal by hand with `bun run dev:web` and a keyboard-wedge scanner, or by typing the badge as a burst with no field focused. Record the run in [implementation status](../../../../docs/implementation-status.md).
7. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.

## References

- [`@tortoise/workstation-sign-in`](../../README.md)
- [Operator workstations: workstation sign-in](../../../../docs/operator-workstations.md#workstation-sign-in)
- [Sign-in pattern](../../../../showcase/patterns/sign-in/README.md)
- [`@tortoise/operator-ui`](../../../../packages/operator-ui/README.md)
