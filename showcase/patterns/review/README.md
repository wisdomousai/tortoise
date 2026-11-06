# Review a test request

This pattern mounts a reusable review feature on the hypothetical [base application](../base/README.md). The application supplies an access view that identifies the requester and authorized reviewers. The feature records the revision reviewed by a technician who did not submit the request.

A subsequent edit does not change the stored signature. The screen shows that the record changed after review. The feature exposes no command to remove an existing signature.

```sh
cd showcase/patterns/review
bun run dev:web
```

## What to try

On a new workspace (port 4355) the launch adds a request from a second technician, `lena`; open it and sign as the local user.

Sign your own request, or sign the same revision twice: both return a conflict.

Change the request and sign the new revision.

An older workspace without `lena` needs a new `WORKSPACE_PATH`.

## References

[write-a-feature](../../../packages/host/skills/write-a-feature/SKILL.md)

`bun test showcase/patterns/review`
