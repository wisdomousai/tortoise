# @tortoise/model-server

Runs a local model (`llama-server` or vLLM) for agents that need one. Compose `createModelServer`. The deployment chooses the model entry, the files and the activation; at every start the plugin checks the weights' digests against the entry and that a fine-tune passed `gateModel`, and refuses to start on a mismatch. `StandInResponder` speaks the server's API for tests.

Primitives:

- [Model entry](../../docs/primitives.md#model-entry)
- [Process port](../../docs/primitives.md#process-port)
- [Requirement declaration](../../docs/primitives.md#requirement-declaration)
- [Agent run](../../docs/primitives.md#agent-run)
- [Audit log](../../docs/primitives.md#audit-log)

## References

- [serve-a-local-model](skills/serve-a-local-model/SKILL.md)
- [Providers: local models](../../docs/providers.md#local-models)
- `bun test plugins/model-server`
