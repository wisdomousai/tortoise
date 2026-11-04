# Parts desk

The spare parts desk of a power transformer plant takes calls from utilities about bushings, tap changer parts, gaskets and relays for transformers in service, and quotes the parts. A desk member finds the transformer by the serial on its rating plate, often from the first digits the caller reads out, looks up the parts that fit its design and builds a quote. A discount above 10 percent needs a supervisor. An assistant panel beside every screen finds transformers and parts, fills the quote builder for the person to check, and requests approval for a larger discount or a cancellation. It runs on a local model through the model server plugin; by default a llama-server stand-in plays the model.

```sh
cd showcase/examples/parts-desk
bun run dev:web
```

The launch seeds three utilities, six transformers, 24 parts and the supervisor mara. With `LOCAL_MODEL_GGUF` set to GGUF weights it starts llama-server on them instead of the stand-in.

## What to try

- Open **TR-40417**: the assembly cards list the parts that fit, with stock and lead time.
- Ask the assistant "TR-404". Two serials match, so it asks which one.
- Ask for a quote of two HV bushings for TR-40417. The quote builder opens filled in, and nothing exists until **Create draft**.
- Ask for 15 percent off the draft. The assistant requests approval, and a supervisor approves or rejects it on **Approvals**.

## Live run on Gemma 4 E4B

On 3 November 2026 the panel held a five-turn conversation on Gemma 4 E4B-it Q4_0 through llama-server on an Apple M3. The model found the transformer and the bushings and filled the quote builder. It asked which transformer in its text instead of through the question tool, named a quote draft that does not exist, and filed a discount request whose base revisions contain a token of its tool-call format, so a supervisor's approval fails with `FORBIDDEN`. `test/assistant-live.test.ts` covers turns 1 and 4 when `LOCAL_MODEL_GGUF` is set; both failed on this model.

## Dictation with a real microphone

Dictation has run only against the browser test's stub recognizer. Chrome and Playwright's full Chromium report on-device English as downloadable, and Playwright's headless shell crashes the page on `SpeechRecognition.available`.

## References

- [Parts desk tutorial](../../../docs/tutorials/parts-desk-1-records-and-quotes.mdx)
- [Agents](../../../docs/agents.md)
- [Model server](../../../plugins/model-server/README.md)
- `bun test showcase/examples/parts-desk`, `bunx playwright test showcase/examples/parts-desk`
