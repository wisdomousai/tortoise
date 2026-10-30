# Suggest a method with a local model

This pattern runs the method suggester of the [agents pattern](../agents/README.md) on a model served on the lab's own machine. A trigger starts the agent on a named model entry, the declared model and the digests of its weights; the model server measures the files at startup and refuses a mismatch, and a fine-tune also needs a passing activation. The agent asks a technician to approve its proposed update and never changes the request itself.

```sh
cd showcase/patterns/local-model
bun run dev:web
```

## What to try

- Turn on the trigger on **Automation** (port 4357) and submit a request without a method. A deterministic stand-in on port 4375 answers by default and tests the wiring, not a model.
- Set `LOCAL_MODEL_GGUF` to a GGUF file before launching to use local weights, or `LAB_METHOD_MODEL` to a JSON model entry with its files and an optional activation. The live test runs only with `LOCAL_MODEL_GGUF` set and a llama-server running.
- Approve as a technician; a viewer's approval cannot commit the update.

## References

- [Model server](../../../plugins/model-server/README.md)
- [serve-a-local-model](../../../plugins/model-server/skills/serve-a-local-model/SKILL.md)
- `bun test showcase/patterns/local-model`
