# @agent-native/pattern-worklist

`pattern-worklist` is a field service crew that draws oil samples for the lab. It composes the base pattern unchanged with a worklist of the sampling rounds that the [assignments pattern](../assignments/README.md) sends it over the [peer link](../../plugins/peer-link/README.md). A technician reports a sample per transformer and marks each round done here. Each report and done mark goes back through the outbox and shows whether the oil lab took it.

## Layer

Content (`patterns/*`). It imports the base pattern, the contracts of `patterns/assignments`, the framework and the site, network, audit and peer link plugins.

## Primitives

The pattern is one [application](../../docs/primitives.md#application) that uses the [worklist](../../docs/primitives.md#worklist) kit of the [assignments package](../../packages/assignments/README.md). Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | `defineWorklist` on the peer lane of the assignments pattern: namespace `worklist`, the [peer target](../../docs/primitives.md#peer-target) `lab` and its `lab-peer` destination |
| `domain.ts` | Server | The state, the base `testRequests` slice and the worklist slice, and the integration principal |
| `policy.ts` | Server | The worklist route: members read, technicians report and mark done, and only the integration principal settles and syncs |
| `application.ts` | Server | The base handlers, `worklistHandlers`, both routes, the plugins, and `connectWorklist` through the peer link's client |
| `screens.tsx`, `ui/rounds.tsx` | Browser | The registry's `worklist` screen with its slots filled, one round with its samples, and the peers screen |
| `ui/round.tsx` | Browser | The brief, the sample form, a sample and its transformer. They repeat views of the assignments pattern, because the web build generates styles only for classes in this application's directory and the frame |
| `dev.ts`, `site-policy.dev.json` | Dev launch | Binds `lab-peer` to the assignments pattern on `127.0.0.1:4362` |

Inbound sync pulls `assignment.feed` from the oil lab as this application's peer principal and applies it as the whole open set. A round the feed no longer lists, because it was withdrawn, closed or marked done there, stops taking reports here. Reports and done marks are outbox effects to `assignment.sampling.report` and `assignment.complete` there. A report that arrives after the done mark is still taken, so a retried delivery is not lost.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-worklist/manifest` | Browser and server | The test requests and worklist modules, the target's component and the plugin manifests |
| `@agent-native/pattern-worklist/application` | Server | `createTestRequestsWorklistApplication` |
| `@agent-native/pattern-worklist/screens` | Browser | The test request screens, the worklist and the peers screen |

## Trust boundary

The oil lab decides every report and done mark as this application's peer principal, against its own records. It refuses a report on a round it withdrew or closed. A report on a transformer outside the round arrives without a subject, and a technician there places it. A refusal is kept on the report here with its reason and is not sent again.

The worklist applies the feed only through the integration principal. A member cannot change what the oil lab sent, and the transformer of a report is checked there, not here.

The peer credential stays in the peer link. Calls carry no person: the oil lab sees `peer:<id>` as the reporter, whoever recorded the report here.

## Dependencies

`@agent-native/pattern-base`, `@agent-native/pattern-assignments`, `@agent-native/assignments`, `@agent-native/peer-link`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test patterns/worklist/
```

- `test/peer.test.ts`: two hosts started with `startPeerPair`, the worklist's destination bound in its site policy.
  - A round sent to the peer arrives with its brief.
  - The sample and the done mark are delivered and recorded there under `peer:<id>`, and the status counts both as accepted.
  - The oil lab's technician accepts the sample, which submits a test request there.
  - A sample on a round withdrawn before delivery is refused with `CONFLICT` and kept here as refused, and the next sync closes the round here.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern, the base or the peer link plugin.
- `e2e/worklist.pw.ts`, in Chromium against two real hosts:
  - A site policy binds `lab-peer` to the oil lab, and a code from its Peers screen connects the two.
  - A round sent to the peer arrives with its transformers.
  - A sample and Done go back, and the report shows as taken there.
  - A technician of the oil lab accepts the sample into a test request.

```sh
bunx playwright test patterns/worklist
```

Run both patterns in the browser:

```sh
cd patterns/assignments && bun run dev:web
cd patterns/worklist && bun run dev:web
```

On the Peers screen of the assignments pattern, create a code. On this pattern's Peers screen, connect the `lab` target with it. Then send a round to the peer from the round board.

## Skills

- [assign-work](../../packages/assignments/skills/assign-work/SKILL.md)
- [connect-two-applications](../../plugins/peer-link/skills/connect-two-applications/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Assignments](../../docs/assignments.md)
- [Peer link plugin](../../plugins/peer-link/README.md)
