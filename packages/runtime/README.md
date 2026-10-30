# @agent-native/runtime

The instance: one transactional runtime per workspace. A command commits state, receipt, journal entries and outbox effects in one transaction, or nothing at all. The host supplies the `ExecutionContext`; capability input cannot set or widen it, and no surface constructs it from tool arguments.

- Primitives: [Instance](../../docs/primitives.md#instance), [Module](../../docs/primitives.md#module), [Feature](../../docs/primitives.md#feature), [Command](../../docs/primitives.md#command), [Nested call](../../docs/primitives.md#nested-call), [Query](../../docs/primitives.md#query), [Collection](../../docs/primitives.md#collection), [Remote query](../../docs/primitives.md#remote-query), [Execution context](../../docs/primitives.md#execution-context), [Agent definition](../../docs/primitives.md#agent-definition), [Approval request](../../docs/primitives.md#approval-request), [Approval dataset](../../docs/primitives.md#approval-dataset), [Policy](../../docs/primitives.md#policy), [Membership](../../docs/primitives.md#membership), [Storage](../../docs/primitives.md#storage), [Journal and live query](../../docs/primitives.md#journal-and-live-query), [Outbox effect](../../docs/primitives.md#outbox-effect), [Worker claims](../../docs/primitives.md#worker-claims), [Reconciliation](../../docs/primitives.md#reconciliation), [Blob store](../../docs/primitives.md#blob-store), [Audit log](../../docs/primitives.md#audit-log).

## References

- [add-capability](skills/add-capability/SKILL.md)
- [Architecture](../../docs/architecture.md), [Authorization](../../docs/authorization.md), [State and reactivity](../../docs/state-and-reactivity.md)
