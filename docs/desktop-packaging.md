# Desktop packaging

The frontend runs in a sandboxed Electron window with context isolation, no Node integration and a minimal preload. The service is a compiled Bun sidecar, and provider executables ship as pinned native resources outside the archive. Details are in [desktop](desktop.md).

```sh
bun run build:web
bun run package:stage darwin-arm64 artifacts/desktop/release-candidate
bun scripts/package-smoke.ts artifacts/desktop/release-candidate
bun run package:desktop darwin-arm64 artifacts/desktop/release-candidate
```

Use a fresh output directory for each stage. Targets are `darwin-arm64`, `darwin-x64`, `win32-x64` and `linux-x64`. Package and smoke-test on the matching platform, because evidence from macOS says nothing about Windows or Linux. Builds are unsigned directories; signing, notarization and installers are separate work.

The desktop host passes the compiled service its runtime manifest and web root, and resources resolve from that manifest rather than from `PATH`. A window that attaches to a running service neither owns nor stops it. Setting `AGENT_NATIVE_WORKSPACE` isolates a smoke test's workspace.

The offline smoke test checks executable bytes, version commands, service startup, the shipped frontend and shutdown, without touching provider credentials. Native account prompts and real inference are opt-in.
