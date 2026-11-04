# Review a test request

In the oil lab, a technician other than the requester reviews and signs a test request; the signature records the revision the reviewer saw, so a later edit shows as a change after review. This pattern adds a reusable review feature to the [base lab desk](../base/README.md): the feature owns the signature state and policy, the lab supplies an access view that identifies technicians and the request's author, and no command changes or removes a signature.

```sh
cd showcase/patterns/review
bun run dev:web
```

## What to try

- On a new workspace (port 4355) the launch adds a request from a second technician, `lena`; open it and sign as the local user.
- Sign your own request, or sign the same revision twice: both return a conflict.
- Change the request and sign the new revision.
- An older workspace without `lena` needs a new `WORKSPACE_PATH`.

## References

- [write-a-feature](../../../packages/host/skills/write-a-feature/SKILL.md)
- `bun test showcase/patterns/review`
