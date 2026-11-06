# @tortoise/model-server

`@tortoise/model-server` manages a declared local model process through `createModelServer`. The deployment selects the model entry and binds its executable and weight files. Before startup the plugin measures the files against the entry's digests and checks any required fine-tune activation.

A mismatch refuses startup. The supported launchers manage `llama-server` and vLLM. Tests can use `StandInResponder` to exercise the server API without loading weights; those fixtures do not establish model behavior.

## References

[serve-a-local-model](skills/serve-a-local-model/SKILL.md)

[Providers: local models](../../docs/agents.md#local-models)

`bun test plugins/model-server`
