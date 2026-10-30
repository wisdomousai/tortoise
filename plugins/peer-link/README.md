# @agent-native/peer-link

Calls between two agent-native apps. The called app publishes a peer API with `definePeerApi`; the calling app declares a peer target with `definePeerTarget`, enrolls with a one-use code and gets its own credential. Compose `createPeerLinkPlugin` from `@agent-native/peer-link/plugin` with its `plugin-manifest` and `plugin-screens`. The enrollment route runs before the session check, so anyone who reaches the listener reaches it; it redeems a code through the instance as the local owner, narrowed to the redeem and resolve capabilities.

Primitives:

- [Peer link](../../docs/primitives.md#peer-link)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Capability binding](../../docs/primitives.md#capability-binding)
- [Peer target](../../docs/primitives.md#peer-target)

## References

- [connect-two-applications](skills/connect-two-applications/SKILL.md)
- [Integration package: peer applications](../../packages/integration/README.md#peer-applications)
- `bun test plugins/peer-link`
