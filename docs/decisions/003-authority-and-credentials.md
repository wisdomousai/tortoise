# 003 — Workspace authority and provider credentials are separate

Accepted: identity establishes a principal, application policy determines permissions, delegation narrows them, and provider credentials fund inference. An approval never elevates a denied operation.

The local service owns one workspace using an OS-held SQLite control lock. Clients attach to it. Provider secrets remain in a fail-closed OS credential vault, outside browser state, domain data and run logs. Account registration and token grants are validated before a connected profile is exposed. There is no automatic paid-provider fallback.
