# @tortoise/intent-scanner

Reads scans from rugged Android devices (Zebra, Honeywell, Datalogic) that broadcast each scan as an intent. Configure the intent in the vendor's scanner software and open the source with `createIntentSource`. The manifest exports the receiver because the scanner software runs in another process, so any other software on the device can send the action unless the profile sets `senderPermission`.

Primitives:

- [Input source](../../docs/primitives.md#input-source)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Native frame](../../docs/primitives.md#native-frame)

## References

- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)
- [Point-of-work input: sources](../../docs/point-of-work-input.md#sources)
- `bun test plugins/intent-scanner`
