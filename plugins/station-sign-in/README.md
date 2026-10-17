# @agent-native/station-sign-in

Shared-station sign-in. An operator scans their badge at a station seat and enters a PIN, and gets a short-lived session of their own. The seat's screen keeps its own session, which is used only to sign people in. The operator's session acts with the operator's own authority under the application's policy.

Layer: plugins (`plugins/*`). Bun only: sign-in needs a serving host.

## Primitives

- [Station sign-in](../../docs/primitives.md#station-sign-in): the `station.*` operations, the sign-in, sign-out and enrollment routes (`stationPaths`), and operator token resolution.
- [Host plugin](../../docs/primitives.md#host-plugin): `createStationSignInPlugin`, `stationSignInPlugin` and `stationSignInPluginManifest`. The plugin uses the authenticated-route and credential hooks of a serving host.

## Entrypoints

| Import                                          | Runs in              | Contents                                                                                                       |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@agent-native/station-sign-in/contracts`       | browser and any host | `stationSignInOperations`, `stationSignInModule`, `stationPaths`, `badgeSchema`, `operatorSessionSchema`.      |
| `@agent-native/station-sign-in/plugin-manifest` | browser and any host | `stationSignInPluginManifest`, with the settings `station-sign-in-seats` and `station-sign-in-minutes`.        |
| `@agent-native/station-sign-in/plugin`          | Bun host             | `createStationSignInPlugin({ now? })` and `stationSignInPlugin`, for `defineApplication({ plugins })`.         |

**The station screen.** It reads badges with `useScanner` from `@agent-native/operator-ui`, routing the badge format to an intent with `createScanRouter`. It then posts `{ badge, pin, seat }` to `stationPaths.signIn` with its own session and gets `201 { token, session }` back. It keeps the token in memory and calls the API with it as a bearer (`createHttpTransport({ token })`) until the session ends. It ends the session by posting `{ token }` to `stationPaths.signOut`.

**Who is a seat.** The local owner, plus the principals listed in `station-sign-in-seats`, such as an attached tablet's. A session lasts `station-sign-in-minutes` (default 15, at most 720). Signing in at a seat ends the session of whoever was signed in there before.

## Trust boundary

**Secrets and storage.**

- The badge value and the PIN reach only the plugin's routes. They never go into a command input, because the runtime stores inputs with receipts.
- Enrollment hashes the PIN with scrypt and a random salt. Sign-in reads the verifier through `station.badge.verifier` and compares in constant time. State keeps only SHA-256 digests of badge values and operator tokens.
- A PIN has few possible values, so its hash does not keep it from someone who can read the workspace. The defense is the lockout: five wrong PINs in a row lock the badge for fifteen minutes. `station.session.start` counts failures and checks the lock inside the transaction, so concurrent attempts cannot get past it.
- An unknown badge, a revoked badge and a wrong PIN get the same answer.

**Who may sign people in.**

- Only a seat's own session may sign people in, and never under a delegated grant. An agent working at the seat cannot open a person's session, and an operator's session cannot open another one.
- Enrollment runs as the caller, so the plugin's policy limits it to admins (the local owner).
- The routes act as the local owner narrowed to the verifier and session operations. The plugin gets that context when the host starts listening; before then the routes answer `UNAVAILABLE`.

**Operator tokens.**

- `station.session.resolve` looks up an operator token on every request. A sign-out, an expiry or a revoked badge applies at the next request.
- The resolved context carries no grant and does not pass the identity port's admission. Like device credentials, operator sessions are for a host whose listener the site policy already admits.

**Audit.** Each attempt is a recorded command, with the badge ID, the seat and whether the PIN matched. The audit log records no badge value, PIN or token digest.

## Gaps

- No badge administration screen exists yet. The `station.badge.*` operations declare a UI exception and are used over HTTP, MCP or the CLI.
- Signing in does not move a seat that an agent holds. The operator takes the screen back with the application's takeover command ([operator workstation pattern](../../docs/operator-workstation-pattern.md)).
- No physical badge reader has been tested.

## Dependencies

- **Framework:** `@agent-native/contracts`, `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application`, `authority`), `@agent-native/runtime` and `@agent-native/adapters` (`http`, for the JSON helpers).
- **External:** `@noble/hashes` (scrypt, SHA-256) and `zod`.
- **Tests only:** `@agent-native/host` and `@agent-native/testing`.

## Tests

```sh
bun test plugins/station-sign-in
```

**`test/sign-in.test.ts`** runs a fixture station application with `startHost` on loopback, with the owner's session as the seat. It shows that:

- an operator signs in with badge and PIN and acts as themselves;
- an operator can neither list badges nor sign others in;
- neither the badge value nor the PIN appears in the workspace database;
- a second sign-in at the seat ends the first session, and sign-out ends the second;
- wrong PINs lock the badge, even against the right PIN, until the lockout passes;
- a session expires;
- revoking a badge ends its sessions.

**`test/scenarios.test.ts`** runs the operations through the direct driver.
