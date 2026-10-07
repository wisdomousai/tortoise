# Design lineage and boundaries

The reference projects informed design decisions rather than supplying copied application code. A portable engine/package boundary, explicit domain commands and desktop harness integration were useful patterns. This starter makes the interaction catalog, commit receipts, authorization and frontend invalidation first-class instead of maintaining separate UI and agent action implementations.

Logical CQRS separates command execution from authorized query snapshots while permitting one local database. Event sourcing is not required. The journal exists for committed change delivery, not as a mandatory reconstruction model for every domain. See [Microsoft's CQRS guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs).

[CASL](https://github.com/stalniy/casl) supplies object/field decisions. This repository owns a deliberately bounded condition translator and tests agreement with memory predicates and parameterized SQL. Framework abstractions cannot promise that arbitrary policy languages translate losslessly to every database.

Current [ChatGPT local app plan usage](https://developers.openai.com/siwc/token-sharing-open-source) is a distinct provider authorization path. It does not grant application workspace permissions or imply blanket eligibility for all hosted commercial products. [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) and [AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) have separate execution and funding boundaries.

Library-specific implementation was checked against current official documentation through Context7 and installed package types. Versions are pinned in the lockfile. Sources describe intended vendor behavior; only the verification ledger describes what was actually exercised in this checkout.
