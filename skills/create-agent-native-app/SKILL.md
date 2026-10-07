---
name: create-agent-native-app
description: Create a local agent-native application from this framework, or add a business capability to an existing application using its shared catalog, authorized runtime and reactive UI.
---

# Create or extend an agent-native application

Preserve the user's actual business domain. The scaffolder exports a complete runnable project/task reference; replacing that example with the requested domain is authored implementation work.

For a new application, read [the setup reference](references/new-application.md), export into an absent target using the repository's `bun run scaffold` command, then shape the domain and product flow. Ask only for choices that materially change implementation; use explicit ports for storage, identity, authorization and provider integration.

For an existing application or a new capability, read [the extension reference](references/add-capability.md) and the application's `docs/capability-authoring.md`. Keep browser-safe contracts, server handlers and UI contributions separate. Every business write goes through the existing runtime; derive agent/API/CLI/schema/documentation surfaces from its catalog.

Run the documented focused checks and report what actually passed. Generated source and deterministic harness tests do not establish provider login, live inference, native packaging or release. Do not reuse discovered credentials, publish a release or install global agent configuration as part of scaffolding.
