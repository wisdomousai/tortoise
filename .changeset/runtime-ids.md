---
'@tortoise/host': minor
'@tortoise/adapters': minor
'@tortoise/frame': minor
'@tortoise/mobile': minor
'@tortoise/deployment': minor
'@tortoise/network': minor
'@tortoise/telemetry': minor
'@tortoise/peer-link': minor
---

The runtime identity follows the tortoise name. Environment variables move from `AGENT_NATIVE_*` to `TORTOISE_*`; `app install` creates and runs as the `tortoise` user under `/opt/tortoise`, `/etc/tortoise`, `/var/lib/tortoise` and `/run/tortoise`; metrics and span attributes move from `agent_native.*` to `tortoise.*`; the peer subject header is `Tortoise-Subject`; the screens module is `virtual:tortoise/screens`; the Android and iOS modules use `dev.tortoise.*` and `Tortoise*`; the driver SDKs are `Tortoise.Driver` and `tortoise_driver`. An existing install, launch script or dashboard needs the new names.
