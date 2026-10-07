# Desktop packaging

See the detailed [desktop implementation and checks](desktop.md). The shared React frontend runs inside a sandboxed Electron window with context isolation, disabled Node integration and a minimal preload. The service is a compiled Bun sidecar; provider executables are pinned native resources outside ASAR.

```sh
bun run build:web
bun run package:stage darwin-arm64 artifacts/desktop/release-candidate
bun scripts/package-smoke.ts artifacts/desktop/release-candidate
bun run package:desktop darwin-arm64 artifacts/desktop/release-candidate
```

Use a new output directory for each immutable stage. Targets are `darwin-arm64`, `darwin-x64`, `win32-x64` and `linux-x64`. Run packaging and smoke checks on the matching OS/architecture; local macOS evidence does not establish Windows/Linux behavior. Builds are unsigned directory distributions. Signing, notarization, installers and public release are separate work.

`AGENT_NATIVE_WORKSPACE` selects a workspace path for an isolated native smoke test. `AGENT_RUNTIME_MANIFEST` and `WEB_ROOT` are supplied by the desktop host to the compiled service. Resources resolve from the manifest, rather than developer PATH or npm shims. An attaching window does not own or terminate an existing service.

Native account prompts and provider inference are opt-in checks. Offline package smoke verifies executable bytes, version commands, service startup, the shipped frontend and shutdown without touching provider credentials.
