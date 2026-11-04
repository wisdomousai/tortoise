---
'@tortoise/agents': minor
'@tortoise/host': minor
'@tortoise/frame': minor
'@tortoise/testing': minor
'@tortoise/scaffold': minor
---

Assistant panel and stored conversations. A run keeps the scrubbed request the person sent as `request`, and an `answer` event records each answer or approval decision. A harness that cannot resume a session receives the earlier turns of its conversation as `earlier`, newest kept within 16,000 characters; the AI SDK harness sends them as chat messages. The host adds `GET /api/v1/runs/:id`, `GET /api/v1/harnesses` and a `runs` CLI verb with `start`, `list`, `show`, `answer` and `cancel`; `runs start --wait` exits 75 while the run waits on a question or approval.

The frame adds `AssistantPanel` and `AssistantButton` for the `aside` of `defineScreens`, and `useAssistantContext` for a screen to hand its record to the panel. The panel picks an agent, sends each message as a run of that agent and shows the conversation the host keeps, so a reload shows it again. `scenarioHarness` and `scenarioTimeout` from `@tortoise/testing` run agent scenarios against a local model when `AGENT_SCENARIOS=live`; generated agent tests use them.
