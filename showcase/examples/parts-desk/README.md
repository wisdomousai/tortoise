# Parts desk

This hypothetical quoting application keeps transformer and part records for a spare-parts desk. A quote must use parts that fit the selected transformer. The application policy requires supervisor authority for a discount above its desk limit.

The assistant uses catalog queries to find records and can prepare the quote form for a person to submit. Approval requests pass through the application's approval policy. Development starts a model-server stand-in; configured local weights enable a separate live-model route. Submitting a quote changes local state and does not deliver it to an external customer system.

```sh
cd showcase/examples/parts-desk
bun run dev:web
```

The launch seeds three utilities, six transformers, 24 parts and the supervisor mara. With `LOCAL_MODEL_GGUF` set to GGUF weights it starts llama-server on them instead of the stand-in.

## What to try

Open **TR-40417**: the assembly cards list the parts that fit, with stock and lead time.

Ask the assistant "TR-404". Two serials match, so it asks which one.

Ask for a quote of two HV bushings for TR-40417. The quote builder opens filled in, and nothing exists until **Create draft**.

Ask for 15 percent off the draft. The assistant requests approval, and a supervisor approves or rejects it on **Approvals**.

## Live run on Gemma 4 E4B

On 3 November 2026 the panel held a five-turn conversation on Gemma 4 E4B-it Q4_0 through llama-server on an Apple M3. The model found the transformer and the bushings and filled the quote builder. It asked which transformer in its text instead of through the question tool, named a quote draft that does not exist, and filed a discount request whose base revisions contain a token of its tool-call format, so a supervisor's approval fails with `FORBIDDEN`. `test/assistant-live.test.ts` covers turns 1 and 4 when `LOCAL_MODEL_GGUF` is set; both failed on this model.

## Dictation with a real microphone

Dictation has run only against the browser test's stub recognizer. Chrome and Playwright's full Chromium report on-device English as downloadable, and Playwright's headless shell crashes the page on `SpeechRecognition.available`.

## References

[Parts desk tutorial](../../../docs/tutorials/parts-desk-1-records-and-quotes.mdx)

[Agents](../../../docs/agents.md)

[Model server](../../../plugins/model-server/README.md)

`bun test showcase/examples/parts-desk`, `bunx playwright test showcase/examples/parts-desk`
