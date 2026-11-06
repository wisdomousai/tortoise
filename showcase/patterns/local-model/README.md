# Suggest a method with a local model

This pattern binds the requesting agent from the [agent pattern](../agents/README.md) to a declared local model entry. The model-server plugin measures the configured weight files before startup and validates any fine-tune activation.

Development uses a deterministic server stand-in until weights are explicitly configured. The agent requests an update for a technician to approve. A fixture success establishes its execution wiring; evaluation against the configured model remains separate.

```sh
cd showcase/patterns/local-model
bun run dev:web
```

## What to try

Turn on the trigger on **Automation** (port 4357) and submit a request without a method. The default deterministic stand-in on port 4375 returns scripted protocol responses.

Set `LOCAL_MODEL_GGUF` to a GGUF file before launching to use local weights, or `LAB_METHOD_MODEL` to a JSON model entry with its files and an optional activation. The live test runs only with `LOCAL_MODEL_GGUF` set and a llama-server running.

Approve as a technician; a viewer's approval cannot commit the update.

## References

[Model server](../../../plugins/model-server/README.md)

[serve-a-local-model](../../../plugins/model-server/skills/serve-a-local-model/SKILL.md)

`bun test showcase/patterns/local-model`
