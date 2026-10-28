# Review a test request

A technician other than the requester signs an oil-lab test request. The signature records the revision the reviewer saw, so a later edit is visible as a change after review. This pattern adds a reusable review [feature](../../../docs/primitives.md#feature) to the [base lab desk](../base/README.md).

## Try review

From the repository root:

```sh
cd showcase/patterns/review
bun run dev:web
```

On a fresh workspace, the development launch seeds a request from a second technician, `lena`. Open that request and sign it as the local owner. A requester cannot sign their own request. A stale revision or a second signature on the same revision returns a conflict; after the request changes, a reviewer can sign the new revision. If an older workspace does not contain `lena`, start with a new `WORKSPACE_PATH` to try the seeded request.

## How the feature is mounted

[`features/review/contracts.ts`](features/review/contracts.ts) declares `review.list` and `review.sign`. [`features/review/feature.ts`](features/review/feature.ts) owns the signature state and policy. The lab supplies an access view in [`access.ts`](access.ts) that checks membership, identifies technicians and finds the request's author. [`application.ts`](application.ts) mounts the feature; [`ui/request-review.tsx`](ui/request-review.tsx) places its panel on the request screen.

The feature policy enforces person-only signing and calls the access view, because the application policy does not decide the feature's operations. Signatures cannot be changed or removed.

## Checks

```sh
bun test showcase/patterns/review
```

The feature conformance and review scenarios cover self-review, stale revisions, repeated signatures and denied callers. See [write-a-feature](../../../packages/host/skills/write-a-feature/SKILL.md) for the reusable feature's extension points.
