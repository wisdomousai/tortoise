# @tortoise/peer-link

`@tortoise/peer-link` authenticates calls between application instances. The receiving application declares its peer API, and the calling application declares a peer target. `createPeerLinkPlugin` manages enrollment and the resulting peer credentials.

Code redemption is exposed before ordinary session authentication and uses a restricted runtime context. Subsequent calls are checked against the enrolled peer's allowed API and the receiving application's policy. Mapping a peer subject to a person is a separately authorized operation.

## References

[connect-two-applications](skills/connect-two-applications/SKILL.md)

[Integration package: peer applications](../../packages/integration/README.md#peer-applications)

`bun test plugins/peer-link`
