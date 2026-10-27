# @agent-native/sample-notes-worklist

`sample-notes-worklist` composes the [notes sample](../notes/README.md) unchanged with a worklist of the note reviews that [notes-assignments](../notes-assignments/README.md) sends it over the [peer link](../../plugins/peer-link/README.md). An editor reports on each review and marks it done here. Each report and done mark goes back through the outbox and shows whether notes-assignments took it.

## Layer

Content (`samples/*`). It imports the base sample, the contracts of `samples/notes-assignments`, the framework and the site, network, audit and peer link plugins.

## Primitives

The sample is one [application](../../docs/primitives.md#application) that uses the worklist kit of the [assignments package](../../packages/assignments/README.md). Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | `defineWorklist` on the peer lane of notes-assignments: namespace `worklist`, the [peer target](../../docs/primitives.md#peer-target) `reviews` and its `reviews-peer` destination |
| `domain.ts` | Server | The state, the base `notes` slice and the worklist slice, and the integration principal |
| `policy.ts` | Server | The worklist route: members read, editors report and mark done, and only the integration principal settles and syncs |
| `application.ts` | Server | The base handlers, `worklistHandlers`, both routes, the plugins, and `connectWorklist` through the peer link's client |
| `screens.tsx`, `ui/reviews.tsx` | Browser | The registry's `worklist` screen with its slots filled, one review with its verdicts, and the peers screen |
| `ui/verdict.tsx` | Browser | The brief's notes, the verdict form, a verdict, and a report's note named from the brief. They repeat views of notes-assignments, because the web build generates styles only for classes in this application's directory and the frame |
| `dev.ts`, `site-policy.dev.json` | Server | Binds `reviews-peer` to notes-assignments on `127.0.0.1:4355` for a dev launch |

Inbound sync pulls `assignment.feed` from notes-assignments as this application's peer principal and applies it as the whole open set. A review it no longer lists, because it was withdrawn, closed or marked done there, stops taking reports here. Reports and done marks are outbox effects to `assignment.review.report` and `assignment.complete` there. A report that arrives after the done mark is still taken, so a retried delivery is not lost.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-notes-worklist/manifest` | Browser and server | The notes and worklist modules, the target's component and the plugin manifests |
| `@agent-native/sample-notes-worklist/application` | Server | `createNotesWorklistApplication` |
| `@agent-native/sample-notes-worklist/screens` | Browser | The note screens, the worklist and the peers screen |

## Trust boundary

notes-assignments decides every report and done mark as this application's peer principal, against its own records. It refuses a report on a review it withdrew or closed. A report about a note outside the review arrives without a note, and an editor places it. A refusal is kept on the report here with its reason and is not sent again.

The worklist applies the feed only through the integration principal. A member cannot change what notes-assignments sent, and the subject of a report is checked there, not here.

The peer credential stays in the peer link. Calls carry no person: notes-assignments sees `peer:<id>` as the reporter, whoever recorded the report here.

## Dependencies

`@agent-native/sample-notes`, `@agent-native/sample-notes-assignments`, `@agent-native/assignments`, `@agent-native/peer-link`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test samples/notes-worklist
```

- `test/peer.test.ts`: two hosts started with `startPeerPair`, the worklist's destination bound in its site policy. A review sent to the peer arrives with its brief. The report and the done mark are delivered and recorded there under `peer:<id>`, and the status counts both as accepted. The issuer's editor accepts the report into the note. A report on a review withdrawn before delivery is refused with `CONFLICT` and kept here as refused, and the next sync closes the review here.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample, the base or the peer link plugin.
- `e2e/worklist.pw.ts`, in Chromium against two real hosts: a site policy binds `reviews-peer` to notes-assignments, and a code from its Peers screen connects the two. A review sent to the peer arrives with its notes. A verdict and Done go back, the report shows as taken there, and an editor of notes-assignments accepts the verdict into its note.

```sh
bunx playwright test samples/notes-worklist
```

Run both samples in the browser:

```sh
cd samples/notes-assignments && bun run dev:web
cd samples/notes-worklist && bun run dev:web
```

On notes-assignments' Peers screen, create a code. On this sample's Peers screen, connect the `reviews` target with it. Then send a review to the peer from the review board.

## Skills

- [connect-two-applications](../../plugins/peer-link/skills/connect-two-applications/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Assignments package](../../packages/assignments/README.md)
- [Peer link plugin](../../plugins/peer-link/README.md)
