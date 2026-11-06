# @tortoise/devices

`@tortoise/devices` decodes scanner input and routes a matching scan to an application command. The package is browser-safe. Sources are registered by the application, and scanner profiles describe the configured device's decoding and routing rules.

A scan supplies input to the command under the current session. It grants no access of its own. Host-side vendor integrations connect through `HostScannerBridge`; device-configuration UI is supplied by the operator registry.

## References

[add-scanner-input](skills/add-scanner-input/SKILL.md)

[Operator input](../../docs/operator-input.md)
