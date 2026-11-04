# @tortoise/connector-files

Reaches a system of record through shared folders. `deliver` writes each effect as a hidden partial file and renames it into place; `lookup` reads the receipt folder, then the drop folder, then the archive, so the other system must write its receipt or archive the file before it removes the file from the drop folder, and must ignore names that start with a dot. The dispatcher looks up before every resend because that system may already hold the file. A receipt is JSON with `status` `accepted`, `rejected` or `pending`; an unreadable receipt holds the effect for a person. An inbox folder feeds inbound sync. The parsers accept only the declared format, and the XML reader refuses DOCTYPE, attributes and nesting.

Primitives:

- [Connector](../../docs/primitives.md#connector)
- [Inbound sync](../../docs/primitives.md#inbound-sync)
- [Requirement declaration](../../docs/primitives.md#requirement-declaration)

## References

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [deploy-an-application](../deployment/skills/deploy-an-application/SKILL.md)
- `bun test plugins/connector-files`
