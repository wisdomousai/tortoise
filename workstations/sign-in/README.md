# @agent-native/workstation-sign-in

The [workstation sign-in](../../docs/glossary.md#workstation-sign-in) [host plugin](../../docs/glossary.md#host-plugin). An [operator](../../docs/glossary.md#operator) scans their badge at a [seat](../../docs/glossary.md#seat), enters a PIN and gets a short-lived [session](../../docs/glossary.md#session) of their own. The seat's screen keeps its own session, which is used only to sign people in.

## Layer

Workstation (`workstations/*`). The plugin runs on the Bun host only, because sign-in needs a serving host. The operator's session acts with the operator's own permissions under the application's [policy](../../docs/glossary.md#policy). The plugin trusts the seat's session only to sign people in.

## Primitives

- [Workstation sign-in](../../docs/primitives.md#workstation-sign-in): the `station.*` [capabilities](../../docs/glossary.md#capability), the sign-in, sign-out and enrollment routes (`stationPaths`), operator token resolution, and the seat and badge [screens](../../docs/glossary.md#screen).
- [Host plugin](../../docs/primitives.md#host-plugin): `createStationSignInPlugin`, `stationSignInPlugin` and `stationSignInPluginManifest`. The plugin uses the authenticated-route and credential hooks of a serving host. Its manifest keeps the operation namespace `station`, which the `station.badge.*` and `station.session.*` operations predate.

## Entrypoints

| Import                                          | Runs in              | Contents                                                                                                       |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@agent-native/workstation-sign-in/contracts`       | browser and any host | `stationSignInOperations`, `stationSignInModule`, `stationPaths`, `badgeSchema`, `operatorSessionSchema`.      |
| `@agent-native/workstation-sign-in/plugin-manifest` | browser and any host | `stationSignInPluginManifest`, with the settings `station-sign-in-seats` and `station-sign-in-minutes`.        |
| `@agent-native/workstation-sign-in/plugin`          | Bun host             | `createStationSignInPlugin({ now? })` and `stationSignInPlugin`, for `defineApplication({ plugins })`.         |
| `@agent-native/workstation-sign-in/plugin-screens`  | browser              | `stationSignInScreens({ seat, work, idleMs?, badgePattern? })` for `defineScreens({ plugins })`, and `useOperatorSession`. |

### Seat screen

`stationSignInScreens` adds the seat screen at `/seat`. Signed out, it:

1. reads a badge with `useScanner` from the operator registry, matching `badgePattern`, or from the scan prompt's manual entry;
2. takes the PIN on the registry's `numeric-pad` with `code` and `masked`, so leading zeros stay and only dots show;
3. posts `{ badge, pin, seat }` to `stationPaths.signIn` with the seat's own session and gets `201 { token, session }` back.

Signed in, it renders `work` inside an operator session. `useOperatorSession()` gives `work` a client and live bindings built on `createHttpTransport({ token })` with their own query cache. The host prefers the bearer over the seat's cookie, so every query and command acts as the operator.

The session ends at the host when the operator signs out, when the seat is idle for `idleMs`, when it expires, and when the seat screen is left. A response that rejects the token, after a sign-out elsewhere or a revoked badge, returns the seat to sign-in. The token lives only in memory, so a page reload leaves the session open until it expires.

### Badge screen

The badge screen at `/badges` lists badges and open sessions with `station.badge.list`, enrolls a badge by posting to `stationPaths.enroll`, and revokes one with `station.badge.revoke`. Only an admin's session can use it.

### Seats and session length

A seat is the local owner or a principal listed in `station-sign-in-seats`, such as an attached tablet's. A session lasts `station-sign-in-minutes`: 15 by default, at most 720. Signing in at a seat ends the session of whoever was signed in there before.

## Trust boundary

### Secrets and storage

- The badge value and the PIN reach only the plugin's routes. They never go into a command input, because the [instance](../../docs/glossary.md#instance) stores inputs with [receipts](../../docs/glossary.md#receipt).
- Enrollment hashes the PIN with scrypt and a random salt. Sign-in reads the verifier through `station.badge.verifier` and compares in constant time.
- State keeps only SHA-256 digests of badge values and operator tokens.
- A PIN has few possible values, so its hash does not keep it from someone who can read the workspace. The lockout is the defense: five wrong PINs in a row lock the badge for fifteen minutes.
- `station.session.start` counts failures and checks the lock inside the transaction, so concurrent attempts cannot get past it.
- An unknown badge, a revoked badge and a wrong PIN get the same answer.

### Seats and enrollment

- Only a seat's own session may sign people in, and never under a delegated [grant](../../docs/glossary.md#grant). An agent working at the seat cannot open a person's session.
- An operator's session cannot open another one.
- Enrollment runs as the caller, so the plugin's policy limits it to admins. The admin is the local owner.
- The routes act as the local owner, narrowed to the verifier and session capabilities. The plugin gets that context when the host starts listening. Before then, the routes answer `UNAVAILABLE`.

### Operator tokens

- `station.session.resolve` looks up an operator token on every request. A sign-out, an expiry or a revoked badge applies at the next request.
- The resolved context carries no grant and does not pass the identity port's admission. Like device credentials, operator sessions are for a host whose listener the deployment policy already admits.

### Audit records

Each attempt is a recorded command, with the badge ID, the seat and whether the PIN matched. The [audit log](../../docs/glossary.md#audit-log) records no badge value, PIN or token digest.

### Known gaps

- Signing in does not move a seat that an agent holds. The operator takes the screen back with the application's takeover command, as [operator workstations](../../docs/operator-workstations.md#seat) describes.
- No physical badge reader has been tested.

## Dependencies

- **Framework:** `@agent-native/contracts`, `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application`, `instance`), `@agent-native/runtime` and `@agent-native/adapters` (`http`, for the JSON helpers). The screens use `@agent-native/frame`, `@agent-native/client` and `@agent-native/react`, and the operator registry's `numeric-pad`, `scan-prompt`, `operator-surface`, `use-scanner` and `use-idle-return` through the `@/` alias.
- **External:** `@noble/hashes` (scrypt, SHA-256) and `zod`. The screens use `react`, `@tanstack/react-query` and `lucide-react`.
- **Tests only:** `@agent-native/host` and `@agent-native/testing`.

## Tests

```sh
bun test workstations/sign-in
```

`test/sign-in.test.ts` runs a fixture station application with `startHost` on loopback, with the owner's session as the seat. It shows that:

- an operator signs in with badge and PIN and acts as themselves;
- an operator can neither list badges nor sign others in;
- neither the badge value nor the PIN appears in the workspace database;
- a second sign-in at the seat ends the first session, and sign-out ends the second;
- wrong PINs lock the badge, even against the right PIN, until the lockout passes;
- a session expires;
- revoking a badge ends its sessions.

`test/scenarios.test.ts` runs the capabilities through the direct driver. `test/ui-bindings.test.ts` checks that the badge screen references `station.badge.list` and `station.badge.revoke`.

`patterns/sign-in` runs the seat and badge screens in a browser launch.

## Skills

- [sign-in-at-a-seat](skills/sign-in-at-a-seat/SKILL.md): composing the plugin and its screens, the work an operator does at the seat, and badge enrollment.
- [bridge-station-screen](../screen-bridge/skills/bridge-station-screen/SKILL.md): a workstation application reached through its screen.
