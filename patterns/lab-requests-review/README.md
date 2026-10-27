# @agent-native/pattern-lab-requests-review

`pattern-lab-requests-review` composes the [lab requests pattern](../lab-requests/README.md) unchanged with `review`, a [feature](../../docs/glossary.md#feature) written in the pattern. A technician other than the requester approves or rejects a test request at the revision they read. The request screen lists the signatures and marks each one made on an earlier revision.

## Layer

Content (`patterns/*`). The feature in `features/review` imports only the framework and names no lab concept, so it can move into a package unchanged when a second application needs it.

## Primitives

The pattern is one [application](../../docs/primitives.md#application) that mounts one [feature](../../docs/primitives.md#feature). Its tests include a [behavioral scenario](../../docs/primitives.md#behavioral-scenario). The feature's files follow `featurePart` in `packages/scaffold/src/templates/feature.ts`:

| File | Runs in | Holds |
| --- | --- | --- |
| `features/review/contracts.ts` | Browser and server | `defineFeatureManifest` with the `review` module: `review.list` and `review.sign` |
| `features/review/feature.ts` | Server | `defineFeature`: the `review` slice, the handlers and the policy over the access view |
| `features/review/screens.tsx` | Browser | `ReviewPanel` and `defineFeatureScreens` |

The application supplies the parts that read its own state:

- `access.ts` is the access view. Members read signatures, technicians sign, and `authorOf` names the requester of a `test-request:<id>` subject.
- `application.ts` mounts the feature with `mountFeature(reviewFeature(), { access, hooks })`. The `newId` and `now` hooks use the application's services.
- `manifest.ts` lists `reviewFeatureManifest` in `defineManifest({ features })`.
- `screens.tsx` passes `reviewScreens({ open: '/requests' })` to `defineScreens({ manifest, features })`. `ui/request-review.tsx` places the panel as a section of the base request screen.

A signature records the subject's revision from `ctx.getRevision`. The panel passes the revision it shows as `expectedRevisions`, so a request changed after the reviewer read it is refused with `CONFLICT`.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-lab-requests-review/manifest` | Browser and server | The lab requests module and the review feature manifest |
| `@agent-native/pattern-lab-requests-review/application` | Server | `createLabRequestsReviewApplication` |
| `@agent-native/pattern-lab-requests-review/screens` | Browser | The base pattern's screens with the review panel on each test request |

## Trust boundary

The application's policy never sees `review.*` operations, so the access view applies the membership gate itself. The feature's policy refuses `review.sign` to an agent run (`PERSON_ONLY`), to a caller the access view denies in the committed or previous state, and to a subject the access view does not know. It refuses the requester of the subject with `SELF_REVIEW`. A reviewer who signed a revision gets `CONFLICT` on a second signature of the same revision, and may sign the subject again after it changes. Signatures are never changed or removed.

## Dependencies

`@agent-native/pattern-lab-requests`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host` and `@agent-native/frame`.

## Tests

```sh
bun test patterns/lab-requests-review/
```

- `test/review.test.ts`: the `featureConformance` cases from `@agent-native/testing/features`, and behavioral scenarios on the embedded instance. They cover a second technician approving a request, the requester refused, a second signature on one revision refused, a stale revision refused, a changed request signed again, and viewer, unknown subject and non-member refusals.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

Run the pattern in the browser:

```sh
cd patterns/lab-requests-review
bun run dev:web
```

## Skills

- [write-a-feature](../../packages/host/skills/write-a-feature/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Architecture: features and host plugins](../../docs/architecture.md#features-and-host-plugins)
- [Authorization](../../docs/authorization.md)
