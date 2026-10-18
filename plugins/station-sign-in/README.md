# @agent-native/station-sign-in

The [station sign-in](../../docs/glossary.md#station-sign-in) [host plugin](../../docs/glossary.md#host-plugin). An [operator](../../docs/glossary.md#operator) scans their badge at a [seat](../../docs/glossary.md#seat), enters a PIN and gets a short-lived [session](../../docs/glossary.md#session) of their own. The seat's screen keeps its own session, which is used only to sign people in.

## Layer

Plugins (`plugins/*`). The plugin runs on the Bun host only, because sign-in needs a serving host. The operator's session acts with the operator's own permissions under the application's [policy](../../docs/glossary.md#policy). The plugin trusts the seat's session only to sign people in.

## Primitives

- [Station sign-in](../../docs/primitives.md#station-sign-in): the `station.*` [capabilities](../../docs/glossary.md#capability), the sign-in, sign-out and enrollment routes (`stationPaths`), and operator token resolution.
- [Host plugin](../../docs/primitives.md#host-plugin): `createStationSignInPlugin`, `stationSignInPlugin` and `stationSignInPluginManifest`. The plugin uses the authenticated-route and credential hooks of a serving host.

## Entrypoints

| Import                                          | Runs in              | Contents                                                                                                       |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@agent-native/station-sign-in/contracts`       | browser and any host | `stationSignInOperations`, `stationSignInModule`, `stationPaths`, `badgeSchema`, `operatorSessionSchema`.      |
| `@agent-native/station-sign-in/plugin-manifest` | browser and any host | `stationSignInPluginManifest`, with the settings `station-sign-in-seats` and `station-sign-in-minutes`.        |
| `@agent-native/station-sign-in/plugin`          | Bun host             | `createStationSignInPlugin({ now? })` and `stationSignInPlugin`, for `defineApplication({ plugins })`.         |

### Seat screen

The seat's screen:

1. reads badges with `useScanner` from `@agent-native/operator-ui`, routing the badge format to an intent with `createScanRouter`;
2. posts `{ badge, pin, seat }` to `stationPaths.signIn` with its own session and gets `201 { token, session }` back;
3. keeps the token in memory and calls the API with it as a bearer (`createHttpTransport({ token })`) until the session ends;
4. ends the session by posting `{ token }` to `stationPaths.signOut`.

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
- The resolved context carries no grant and does not pass the identity port's admission. Like device credentials, operator sessions are for a host whose listener the site policy already admits.

### Audit records

Each attempt is a recorded command, with the badge ID, the seat and whether the PIN matched. The [audit log](../../docs/glossary.md#audit-log) records no badge value, PIN or token digest.

### Known gaps

- No badge administration screen exists yet. The `station.badge.*` capabilities declare a UI exception and are used over HTTP, MCP or the CLI.
- Signing in does not move a seat that an agent holds. The operator takes the screen back with the application's takeover command, as [operator workstations](../../docs/operator-workstations.md#seat) describes.
- No physical badge reader has been tested.

## Dependencies

- **Framework:** `@agent-native/contracts`, `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application`, `instance`), `@agent-native/runtime` and `@agent-native/adapters` (`http`, for the JSON helpers).
- **External:** `@noble/hashes` (scrypt, SHA-256) and `zod`.
- **Tests only:** `@agent-native/host` and `@agent-native/testing`.

## Tests

```sh
bun test plugins/station-sign-in
```

`test/sign-in.test.ts` runs a fixture station application with `startHost` on loopback, with the owner's session as the seat. It shows that:

- an operator signs in with badge and PIN and acts as themselves;
- an operator can neither list badges nor sign others in;
- neither the badge value nor the PIN appears in the workspace database;
- a second sign-in at the seat ends the first session, and sign-out ends the second;
- wrong PINs lock the badge, even against the right PIN, until the lockout passes;
- a session expires;
- revoking a badge ends its sessions.

`test/scenarios.test.ts` runs the capabilities through the direct driver.

## Skills

- [bridge-station-screen](../../packages/station/skills/bridge-station-screen/SKILL.md): station software reached through its screen.
