# @tortoise/intent-scanner

`@tortoise/intent-scanner` receives scans broadcast by an Android scanner service. The application opens the source with `createIntentSource`, and the scanner profile identifies the broadcast action and payload fields.

The receiver is exported so the scanner service can reach it from another process. Other applications can send that action unless the profile supplies `senderPermission`. Treat the decoded scan as untrusted command input under the operator's session.

## References

[add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)

[Operator input: sources](../../docs/operator-input.md#sources)

`bun test plugins/intent-scanner`
