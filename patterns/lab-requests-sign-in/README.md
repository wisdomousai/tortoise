# @agent-native/pattern-lab-requests-sign-in

`pattern-lab-requests-sign-in` composes the [lab requests pattern](../lab-requests/README.md) unchanged with [workstation sign-in](../../docs/glossary.md#workstation-sign-in) at a shared lab bench. A technician scans a badge at the bench's [terminal](../../docs/glossary.md#terminal), enters a PIN, and submits test requests as themselves until they sign out or the terminal sits idle. The owner enrolls and revokes badges.

## Layer

Content (`patterns/*`). It imports the base pattern, the framework and `workstations/sign-in`.

## Primitives

The pattern is one [application](../../docs/primitives.md#application). It composes:

- [workstation sign-in](../../docs/primitives.md#workstation-sign-in): the station sign-in plugin, the terminal screen for `bench-2` and the badge screen;
- the operator [UI registry](../../docs/primitives.md#ui-registry)'s scanner [input source](../../docs/primitives.md#input-source), keypad, scan prompt and idle return, through the terminal screen and the bench screen;
- the base pattern's [policy](../../docs/glossary.md#policy), under which `ana` is a technician and `ben` a viewer, so a signed-in viewer reads requests but cannot submit one.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `manifest.ts` | Browser and server | The lab requests module and the station sign-in plugin manifest |
| `application.ts` | Server | `createLabRequestsSignInApplication`, with `benchMembers` and the plugin |
| `screens.tsx` | Browser | The base screens, the terminal at `/terminal` (the home screen) and the badge screen |
| `ui/bench.tsx` | Browser | `BenchWork`: submitting a test request for a scanned specimen label, and the latest requests, as the operator |

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-lab-requests-sign-in/manifest` | Browser and server | The lab requests module and the station sign-in plugin manifest |
| `@agent-native/pattern-lab-requests-sign-in/application` | Server | `createLabRequestsSignInApplication` and `benchMembers` |
| `@agent-native/pattern-lab-requests-sign-in/screens` | Browser | The test request screens, the terminal and the badge screen |

## Trust boundary

The owner's browser session is the terminal. It may sign people in, and only the owner may enroll or revoke badges. The badge value and the PIN reach only the plugin's routes, and the workspace keeps their digests.

`BenchWork` reads and writes only through `useOperatorSession()`, whose client sends the operator token. The host prefers that bearer over the terminal's cookie, so a test request records the operator as its requester and the lab requests policy judges the operator's role. The token lives in the terminal screen's memory. Signing out, two idle minutes, leaving the terminal screen and the session's expiry after 15 minutes each end it.

## Dependencies

`@agent-native/pattern-lab-requests`, `@agent-native/workstation-sign-in`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test patterns/lab-requests-sign-in/
```

- `test/sign-in.test.ts`: a serving host with the owner's connection token as the terminal. A technician whose PIN starts with zero signs in and submits a test request that records the technician as the requester. The next sign-in at the bench ends that session, and the viewer who signed in reads the request but cannot submit one or list badges. A session ends when it expires, and a revoked badge cannot sign in.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern, the base or the sign-in workstation.

Run the pattern in the browser:

```sh
cd patterns/lab-requests-sign-in
bun run dev:web
```

Enroll badges for `ana` and `ben` on the Badges screen, with badge numbers of the form `LAB-0042`. On the Terminal screen, scan a badge with a keyboard-wedge scanner, or type it as a burst with no field focused, or use **Type instead**. Specimen labels of the form `B-1042-03` scan into the bench's specimen field.

## Skills

- [sign-in-at-a-terminal](../../workstations/sign-in/skills/sign-in-at-a-terminal/SKILL.md)
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Operator workstations: workstation sign-in](../../docs/operator-workstations.md#workstation-sign-in)
- [Workstation sign-in](../../workstations/sign-in/README.md)
- [Operator UI](../../packages/operator-ui/README.md)
