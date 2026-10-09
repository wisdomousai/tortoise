# Design lineage

Other projects informed the design, but no application code was copied. A portable engine boundary, explicit domain commands and desktop harness integration were useful patterns. This starter adds what they lacked: one interaction catalog for UI and agents alike, commit receipts, authorization in the runtime, and live invalidation in the frontend.

Logical CQRS separates commands from authorized query snapshots while allowing one local database. Event sourcing is not required. The journal delivers committed changes; it is not a model every domain has to rebuild from. See [Microsoft's CQRS guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs).

[CASL](https://github.com/stalniy/casl) makes the object and field decisions. This repository owns a deliberately small condition translator and tests that it agrees with in-memory and SQL evaluation. No policy language translates losslessly to every database.

Provider plans and SDKs each have their own execution and funding boundaries: [ChatGPT local app plan usage](https://developers.openai.com/siwc/token-sharing-open-source), the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) and the [AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling). None of them grants workspace permissions.

Vendor documentation describes intended behavior. Only the [implementation status](implementation-status.md) records what was actually exercised here.
